const express = require('express');
const swaggerUi = require('swagger-ui-express');

const openapi = require('./openapi.json');

// Opening the storage module creates tasks.db, its table, and the seed rows
// if they are not there yet.
require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Interactive documentation, generated from the OpenAPI document next to this file.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

// The "database" for now: a plain array. Everything in it dies when the
// process does — that is the whole point of Week 3.
const SEED_TASKS = [
  { id: 1, title: 'Finish DSA assignment', done: false },
  { id: 2, title: 'Email academic advisor', done: true },
  { id: 3, title: 'Read chapter on virtual memory', done: false },
];

let tasks = SEED_TASKS.map((task) => ({ ...task }));

function findTask(id) {
  return tasks.find((task) => task.id === id);
}

function nextId() {
  if (tasks.length === 0) return 1;
  return Math.max(...tasks.map((task) => task.id)) + 1;
}

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
  const { done, search } = req.query;
  let result = tasks;

  if (done !== undefined) {
    if (done !== 'true' && done !== 'false') {
      return res.status(400).json({ error: 'done filter must be true or false' });
    }
    const wantDone = done === 'true';
    result = result.filter((task) => task.done === wantDone);
  }

  if (search !== undefined) {
    const word = String(search).trim();
    if (word === '') {
      return res.status(400).json({ error: 'search must not be blank' });
    }
    const lower = word.toLowerCase();
    result = result.filter((task) => task.title.toLowerCase().includes(lower));
  }

  res.json(result);
});

app.get('/stats', (req, res) => {
  const done = tasks.filter((task) => task.done).length;
  res.json({ total: tasks.length, done, open: tasks.length - done });
});

app.post('/reset', (req, res) => {
  tasks = SEED_TASKS.map((task) => ({ ...task }));
  res.json(tasks);
});

app.post('/tasks', (req, res) => {
  const { title } = req.body ?? {};

  if (title === undefined || title === null || String(title).trim() === '') {
    return res.status(400).json({ error: 'title must be a non-empty string' });
  }

  const task = { id: nextId(), title: String(title).trim(), done: false };
  tasks.push(task);

  res.status(201).json(task);
});

app.get('/tasks/:id', (req, res) => {
  const task = findTask(Number(req.params.id));

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

  const task = findTask(Number(req.params.id));

  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  Object.assign(task, changes);

  res.json(task);
});

app.delete('/tasks/:id', (req, res) => {
  const index = tasks.findIndex((task) => task.id === Number(req.params.id));

  if (index === -1) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  tasks.splice(index, 1);

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
