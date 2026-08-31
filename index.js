const express = require('express');
const swaggerUi = require('swagger-ui-express');

const openapi = require('./openapi.json');

// Opening the storage module creates tasks.db, its table, and the seed rows
// if they are not there yet.
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Interactive documentation, generated from the OpenAPI document next to this file.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.get('/', (req, res) => {
  res.json({
    name: 'Task API',
    version: '1.0',
    endpoints: ['/tasks', '/stats', '/reset'],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/tasks', (req, res) => {
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

  res.json(store.listTasks(filters));
});

app.get('/stats', (req, res) => {
  res.json(store.stats());
});

app.post('/reset', (req, res) => {
  res.json(store.reset());
});

app.post('/tasks', (req, res) => {
  const { title } = req.body ?? {};

  if (title === undefined || title === null || String(title).trim() === '') {
    return res.status(400).json({ error: 'title must be a non-empty string' });
  }

  const task = store.create(String(title).trim());

  res.status(201).json(task);
});

app.get('/tasks/:id', (req, res) => {
  const task = store.findById(Number(req.params.id));

  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  res.json(task);
});

app.put('/tasks/:id', (req, res) => {
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

  const task = store.update(Number(req.params.id), changes);

  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  res.json(task);
});

app.delete('/tasks/:id', (req, res) => {
  const deleted = store.remove(Number(req.params.id));

  if (!deleted) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  res.status(204).send();
});

// Anything that reached here matched no route above.
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.path}` });
});

// express.json() throws when the body is not valid JSON. Without this the
// client would get Express's default HTML error page instead of our JSON.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'request body must be valid JSON' });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Task API listening on http://localhost:${PORT}`);
});
