const express = require('express');
const swaggerUi = require('swagger-ui-express');

const openapi = require('./openapi.json');

// The only module that knows SQL exists. Which engine is behind it — an array,
// a SQLite file, a Postgres server — is not this file's business.
const store = require('./db');
const { checkConnection } = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Interactive documentation, generated from the OpenAPI document next to this file.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

// A path parameter is always a string, and `Number('abc')` is NaN. SQLite was
// forgiving about that — NaN simply matched no row and the request 404'd. A
// Postgres integer column is not: the driver rejects NaN and the request would
// surface as a 500 for what is plainly a client mistake.
//
// So the id is parsed here, in the HTTP layer, before it can reach the storage
// module. This is the second place the swap from SQLite to Postgres leaked
// upward, and both leaks are about the new engine being stricter than the old.
function parseId(raw) {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

app.get('/', (req, res) => {
  res.json({
    name: 'Task API',
    version: '1.0',
    endpoints: ['/tasks', '/stats', '/reset'],
  });
});

// A liveness check that actually asks the database whether it is there. A
// process can be perfectly alive while every request that matters fails, so a
// health check that only proves "node is running" tells an orchestrator nothing
// worth knowing. 503 is the correct answer when the app is up but not usable.
app.get('/health', async (req, res) => {
  try {
    await store.ping();
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

app.get('/tasks', async (req, res) => {
  const { done, search, sort } = req.query;
  const filters = {};

  // The query string is still validated here, in the HTTP layer, before any of
  // it reaches the storage module. The database is the last line of defence,
  // not the first.
  if (done !== undefined) {
    if (done !== 'true' && done !== 'false') {
      return res.status(400).json({ error: 'done filter must be true or false' });
    }
    filters.done = done === 'true';
  }

  if (search !== undefined) {
    const word = String(search).trim();
    if (word === '') {
      return res.status(400).json({ error: 'search must not be blank' });
    }
    filters.search = word;
  }

  if (sort !== undefined) {
    if (sort !== 'title') {
      return res.status(400).json({ error: 'sort must be title' });
    }
    filters.sort = sort;
  }

  res.json(await store.listTasks(filters));
});

app.get('/stats', async (req, res) => {
  res.json(await store.stats());
});

app.post('/reset', async (req, res) => {
  res.json(await store.reset());
});

app.post('/tasks', async (req, res) => {
  const { title } = req.body ?? {};

  if (title === undefined || title === null || String(title).trim() === '') {
    return res.status(400).json({ error: 'title must be a non-empty string' });
  }

  const task = await store.create(String(title).trim());

  res.status(201).json(task);
});

app.get('/tasks/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const task = id === null ? undefined : await store.findById(id);

  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  res.json(task);
});

app.put('/tasks/:id', async (req, res) => {
  const body = req.body ?? {};
  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const hasDone = Object.prototype.hasOwnProperty.call(body, 'done');

  // Check the body before we check the id: a malformed request is the
  // client's mistake no matter which task it was aimed at.
  if (!hasTitle && !hasDone) {
    return res.status(400).json({ error: 'provide title or done to update' });
  }

  const changes = {};

  if (hasTitle) {
    if (body.title === null || String(body.title).trim() === '') {
      return res.status(400).json({ error: 'title must not be empty' });
    }
    changes.title = String(body.title).trim();
  }

  if (hasDone) {
    if (typeof body.done !== 'boolean') {
      return res.status(400).json({ error: 'done must be a boolean value' });
    }
    changes.done = body.done;
  }

  const id = parseId(req.params.id);
  const task = id === null ? undefined : await store.update(id, changes);

  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  res.json(task);
});

app.delete('/tasks/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const deleted = id === null ? false : await store.remove(id);

  if (!deleted) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  res.status(204).send();
});

// Anything that reached here matched no route above.
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

// express.json() throws when the body is not valid JSON. Express 5 also routes
// rejected promises from async handlers here, which is what makes the `await`s
// above safe without a try/catch around every one of them.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'request body must be valid JSON' });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Connecting is now something that can fail and take time, so startup is a
// sequence rather than a single call: reach the database, create the table,
// seed if empty, and only then accept traffic. Listening before the database is
// ready would mean answering requests we cannot serve.
async function main() {
  const { attempts, seeded } = await store.init();

  if (attempts > 1) {
    console.log(`Postgres became reachable after ${attempts} attempts`);
  }
  console.log(seeded ? 'Seeded three example tasks' : 'Existing tasks found, skipping seed');

  // A failed check is logged, not fatal. If Supabase is down, the auth routes
  // cannot work — but the task endpoints do not depend on it, and taking the
  // whole API offline because one upstream is unreachable would turn a partial
  // outage into a total one.
  try {
    await checkConnection();
    console.log('Connected to Supabase');
  } catch (err) {
    console.error(`Supabase unreachable, auth routes will fail: ${err.message}`);
  }

  const server = app.listen(PORT, () => {
    console.log(`Task API listening on http://localhost:${PORT}`);
  });

  // Compose sends SIGTERM on `docker compose down`. Without handling it the
  // process is killed outright after a grace period, cutting off any request
  // still in flight. This finishes them, then closes the pool.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`${signal} received, shutting down`);
      server.close(async () => {
        await store.close();
        process.exit(0);
      });
    });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
