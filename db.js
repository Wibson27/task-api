// Storage layer. Everything that knows SQL lives in this file, and nothing
// else in the project does. That is the whole point of Assignment 2: the
// routes in index.js keep their promise to clients while what sits behind
// them changes from an array to a database on disk.
const path = require('node:path');
const Database = require('better-sqlite3');

// A SQLite database is one ordinary file. Opening a path that does not exist
// creates it, so a fresh clone builds its own tasks.db on the first run with
// no setup step for whoever cloned it.
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'tasks.db');

const db = new Database(DB_FILE);

// Write-ahead logging. Changes are appended to a separate log file and folded
// into the main database later, which means a reader never blocks the writer
// and a crash mid-write cannot leave a half-written page behind.
db.pragma('journal_mode = WAL');

const SEED_TASKS = [
  { title: 'Finish DSA assignment', done: 0 },
  { title: 'Email academic advisor', done: 1 },
  { title: 'Read chapter on virtual memory', done: 0 },
];

// AUTOINCREMENT rather than a bare INTEGER PRIMARY KEY: without it SQLite
// reuses the highest rowid after that row is deleted, so a new task could be
// handed the id of a task that has just been removed. AUTOINCREMENT keeps the
// "ids are never reused" behaviour the in-memory version had.
//
// done is an INTEGER because SQLite has no boolean type. The CHECK constraint
// stops anything other than 0 or 1 reaching the column, whatever writes to it.
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT    NOT NULL,
      done  INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
    )
  `);
}

// Counting and inserting inside one transaction makes the seed all-or-nothing.
// Two servers starting at the same moment cannot both read a count of 0 and
// then both insert, which is how you end up with six example tasks.
function seedIfEmpty() {
  const seed = db.transaction(() => {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM tasks').get();

    if (count > 0) return false;

    const insert = db.prepare('INSERT INTO tasks (title, done) VALUES (?, ?)');
    for (const task of SEED_TASKS) {
      insert.run(task.title, task.done);
    }

    return true;
  });

  return seed();
}

migrate();
const seeded = seedIfEmpty();

// SQLite has no boolean type, so `done` arrives from the driver as the number
// 0 or 1. Assignment 1 promised clients a real JSON boolean, and that promise
// is the thing this assignment must not break — so every row is mapped on the
// way out. This one function is the reason the API's responses are unchanged.
function toTask(row) {
  if (!row) return undefined;
  return { id: row.id, title: row.title, done: row.done === 1 };
}

// Statements are prepared once, here, rather than on every request. Preparing
// compiles the SQL text into SQLite's bytecode; reusing the prepared statement
// skips that parse and plan on every subsequent call.
const statements = {
  findAll: db.prepare('SELECT id, title, done FROM tasks ORDER BY id'),
  findById: db.prepare('SELECT id, title, done FROM tasks WHERE id = ?'),
  create: db.prepare('INSERT INTO tasks (title, done) VALUES (?, 0) RETURNING id, title, done'),
  update: db.prepare(`
    UPDATE tasks
       SET title = COALESCE(?, title),
           done  = COALESCE(?, done)
     WHERE id = ?
    RETURNING id, title, done
  `),
  remove: db.prepare('DELETE FROM tasks WHERE id = ? RETURNING id'),
  stats: db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM tasks'),
};

function findAll() {
  return statements.findAll.all().map(toTask);
}

// The `?` is a bound parameter. The value travels to SQLite separately from
// the SQL text, so it is never parsed as SQL — an id of "1; DROP TABLE tasks"
// is looked up as a meaningless string rather than executed.
function findById(id) {
  return toTask(statements.findById.get(id));
}

// The id is not chosen here. INSERT leaves it out, SQLite assigns it from the
// AUTOINCREMENT sequence, and RETURNING hands the finished row straight back —
// so there is no second SELECT and no window where another writer could take
// the id we were about to read.
function create(title) {
  return toTask(statements.create.get(title));
}

// COALESCE(?, column) is what keeps Assignment 1's partial updates working in
// one statement: pass NULL for a field the client did not send and the column
// keeps its current value. The alternative — SELECT the row, merge in JS, then
// UPDATE — is a read-modify-write, and another writer could change the row in
// the gap between the two queries. This cannot, because SQLite evaluates the
// whole statement against one consistent snapshot.
//
// `done: false` must survive this too. COALESCE only falls through on NULL,
// and 0 is not NULL, so an explicit false is written rather than ignored.
function update(id, { title, done }) {
  const row = statements.update.get(
    title === undefined ? null : title,
    done === undefined ? null : Number(done),
    id,
  );

  return toTask(row);
}

// RETURNING gives us the deleted row's id, or undefined if the WHERE matched
// nothing. That single result answers "did it exist?" without a separate
// SELECT beforehand.
function remove(id) {
  return statements.remove.get(id) !== undefined;
}

// Counted by the database rather than by pulling every row into JavaScript and
// counting there. SUM works because `done` is already 0 or 1; COALESCE covers
// the empty table, where SUM returns NULL rather than 0.
function stats() {
  const { total, done } = statements.stats.get();
  return { total, done, open: total - done };
}

// Wipe and re-seed as one unit. sqlite_sequence is SQLite's own bookkeeping
// table for AUTOINCREMENT counters — clearing this table's row restarts ids at
// 1, so a reset returns the same three tasks with the same ids every time.
function reset() {
  const run = db.transaction(() => {
    db.prepare('DELETE FROM tasks').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'tasks'").run();

    const insert = db.prepare('INSERT INTO tasks (title, done) VALUES (?, ?)');
    for (const task of SEED_TASKS) {
      insert.run(task.title, task.done);
    }
  });

  run();
  return findAll();
}

module.exports = {
  db,
  DB_FILE,
  seeded,
  findAll,
  findById,
  create,
  update,
  remove,
  stats,
  reset,
};
