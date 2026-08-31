const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

app.get('/', (req, res) => {
  res.json({
    name: 'Task API',
    version: '1.0',
    endpoints: ['/tasks'],
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/tasks', (req, res) => {
  res.json(tasks);
});

app.get('/tasks/:id', (req, res) => {
  const task = findTask(Number(req.params.id));

  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found` });
  }

  res.json(task);
});

app.listen(PORT, () => {
  console.log(`Task API listening on http://localhost:${PORT}`);
});
