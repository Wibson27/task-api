// Storage layer. Everything that knows SQL lives in this file, and nothing else
// in the project does. This is the third engine to sit behind it — an array in
// A1, a SQLite file in A2, and now a PostgreSQL server in a container — and the
// API above it has kept the same promise to clients every time.
const { Pool } = require('pg');

// The connection string is configuration, not code: it differs between running
// the app on your machine (host `localhost`) and running it inside compose
// (host `db`), and it carries a password that must never be committed. It comes
// from the environment, and the app refuses to start without it rather than
// falling back to a guessed default.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env, or run the stack with docker compose up.',
  );
}

// A pool, not a single connection. Each HTTP request borrows a connection,
// runs its query, and returns it. Postgres forks a backend process per
// connection, so opening one per request would be far more expensive than the
// query itself — and the server has a hard connection limit that unpooled
// clients hit quickly under load.
const pool = new Pool({ connectionString });

const SEED_TASKS = [
  { title: 'Finish DSA assignment', done: false },
  { title: 'Email academic advisor', done: true },
  { title: 'Read chapter on virtual memory', done: false },
];

// An arbitrary but fixed number identifying the "seeding" lock. Postgres
// advisory locks are just agreed-upon integers; any process using this same
// number contends for the same lock.
const SEED_LOCK_ID = 4711;

// `docker compose up` starts both containers at once, and the API is ready long
// before Postgres has finished initialising. `depends_on` only waits for the
// container to *start*, not for the database to accept connections, so the first
// query would otherwise fail with ECONNREFUSED and take the app down with it.
// Retrying is what turns a race into a short wait.
async function waitForDatabase(attempts = 30, delayMs = 1000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return attempt;
    } catch (err) {
      if (attempt === attempts) {
        throw new Error(`Could not reach Postgres after ${attempts} attempts: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// SERIAL gives the id column a sequence that hands out increasing numbers and
// never reuses one, which is the same "ids are never reused" behaviour the array
// and SQLite versions had.
//
// `done` is a real BOOLEAN here. SQLite had no boolean type and handed back 0/1,
// so A2 needed a mapping function to keep the API's responses honest. Postgres
// has the type and the driver returns a JavaScript boolean, so that mapping
// simply disappears — the strongly typed database does the work the application
// used to do.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id         SERIAL      PRIMARY KEY,
      title      TEXT        NOT NULL,
      done       BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Note how much easier this is than the same change was in SQLite. Postgres
  // accepts a non-constant DEFAULT on ADD COLUMN and backfills existing rows
  // itself, so the three-step add-backfill-populate dance A2 needed collapses
  // into the table definition above.

  await pool.query('CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks (done)');
}

// Seeding is guarded by a transaction-scoped advisory lock. In A2 this was
// belt-and-braces; here it is load-bearing. A real database server accepts
// connections from many clients at once, so scaling the api service to two
// replicas means two processes can genuinely reach the count-then-insert at the
// same instant. The first to arrive holds the lock; the second waits, then reads
// a count of 3 and inserts nothing. The lock is released when the transaction
// ends, however it ends.
async function seedIfEmpty() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_ID]);

    // COUNT(*) is a bigint, and the driver returns bigints as strings because
    // they can exceed what a JavaScript number represents exactly. The ::int
    // cast asks Postgres for something that is safely a number.
    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM tasks');

    if (rows[0].count > 0) {
      await client.query('COMMIT');
      return false;
    }

    for (const task of SEED_TASKS) {
      await client.query('INSERT INTO tasks (title, done) VALUES ($1, $2)', [task.title, task.done]);
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

let seeded = false;

async function init() {
  const attempts = await waitForDatabase();
  await migrate();
  seeded = await seedIfEmpty();
  return { attempts, seeded };
}

// A health check that does not touch the database is theatre: the process can be
// perfectly alive while every request that matters fails. This runs a real query.
async function ping() {
  await pool.query('SELECT 1');
  return true;
}

// Closing the pool lets in-flight queries finish and releases the sockets, so a
// container stopping does not leave connections hanging on the Postgres side.
async function close() {
  await pool.end();
}

module.exports = {
  init,
  isSeeded: () => seeded,
  ping,
  close,
};
