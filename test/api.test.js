// These tests describe the API contract from Assignment 1 — the endpoints, the
// status codes, and the exact shape of every response body. Not one of them
// mentions SQLite, an array, or a table.
//
// That is the point. They passed when a JavaScript array was the storage, and
// they pass now that a file on disk is. If a test suite cannot tell which one
// is behind the routes, then storage really is an implementation detail and the
// promise the API makes to its clients survived the migration intact.
//
// Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const DB_FILE = path.join(os.tmpdir(), `task-api-test-${process.pid}.db`);
const ROOT = path.join(__dirname, '..');

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DB_FILE },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => reject(new Error('server did not start in time')), 15000);

    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
}

function removeDatabase() {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${DB_FILE}${suffix}`, { force: true });
  }
}

async function api(method, url, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(BASE + url, options);
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? null : JSON.parse(text),
    raw: text,
  };
}

before(async () => {
  removeDatabase();
  server = await startServer();
});

after(async () => {
  await stopServer(server);
  removeDatabase();
});

// ---------------------------------------------------------------- meta

test('GET / describes the API', async () => {
  const { status, body } = await api('GET', '/');
  assert.equal(status, 200);
  assert.equal(body.name, 'Task API');
  assert.equal(body.version, '1.0');
  assert.ok(Array.isArray(body.endpoints));
});

test('GET /health reports ok', async () => {
  const { status, body } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok' });
});

// ---------------------------------------------------------------- read

test('GET /tasks returns the three seeded tasks', async () => {
  const { status, body } = await api('GET', '/tasks');
  assert.equal(status, 200);
  assert.equal(body.length, 3);
});

test('every task has exactly id, title and done — and done is a real boolean', async () => {
  const { body } = await api('GET', '/tasks');
  for (const task of body) {
    // The contract is the *exact* key set. An extra field would break a client
    // that round-trips the object, and this is where SQLite's 0/1 would leak
    // through as a number if the storage layer forgot to map it.
    assert.deepEqual(Object.keys(task).sort(), ['done', 'id', 'title']);
    assert.equal(typeof task.id, 'number');
    assert.equal(typeof task.title, 'string');
    assert.equal(typeof task.done, 'boolean');
  }
});

test('GET /tasks/:id returns one task', async () => {
  const { status, body } = await api('GET', '/tasks/1');
  assert.equal(status, 200);
  assert.equal(body.id, 1);
});

test('GET /tasks/:id 404s on an unknown id', async () => {
  const { status, body } = await api('GET', '/tasks/999');
  assert.equal(status, 404);
  assert.equal(body.error, 'Task 999 not found');
});

test('a non-numeric id 404s rather than crashing', async () => {
  const { status, body } = await api('GET', '/tasks/abc');
  assert.equal(status, 404);
  assert.equal(body.error, 'Task abc not found');
});

// ---------------------------------------------------------------- create

test('POST /tasks creates a task and returns 201', async () => {
  const { status, body } = await api('POST', '/tasks', { title: 'Written by a test' });
  assert.equal(status, 201);
  assert.equal(body.title, 'Written by a test');
  assert.equal(body.done, false);
  assert.equal(typeof body.id, 'number');
});

test('POST /tasks trims the title', async () => {
  const { body } = await api('POST', '/tasks', { title: '   padded   ' });
  assert.equal(body.title, 'padded');
});

test('POST /tasks ignores a client-supplied id and done', async () => {
  const { body } = await api('POST', '/tasks', { id: 999, title: 'Not my id', done: true });
  assert.notEqual(body.id, 999);
  assert.equal(body.done, false);
});

test('POST /tasks rejects a missing, null, or blank title with 400', async () => {
  for (const body of [{}, { title: null }, { title: '   ' }]) {
    const result = await api('POST', '/tasks', body);
    assert.equal(result.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(result.body.error, 'title must be a non-empty string');
  }
});

// ---------------------------------------------------------------- update

test('PUT /tasks/:id updates done and leaves title alone', async () => {
  const created = await api('POST', '/tasks', { title: 'Toggle me' });
  const { status, body } = await api('PUT', `/tasks/${created.body.id}`, { done: true });
  assert.equal(status, 200);
  assert.equal(body.done, true);
  assert.equal(body.title, 'Toggle me');
});

test('PUT /tasks/:id can set done back to false', async () => {
  const created = await api('POST', '/tasks', { title: 'Toggle me back' });
  await api('PUT', `/tasks/${created.body.id}`, { done: true });
  const { body } = await api('PUT', `/tasks/${created.body.id}`, { done: false });
  // COALESCE falls through on NULL only, so an explicit false must be written
  // rather than silently treated as "no change".
  assert.equal(body.done, false);
});

test('PUT /tasks/:id rejects an empty body, a blank title, and a non-boolean done', async () => {
  const cases = [
    [{}, 'provide title or done to update'],
    [{ title: '  ' }, 'title must not be empty'],
    [{ done: 'false' }, 'done must be a boolean value'],
  ];
  for (const [body, expected] of cases) {
    const result = await api('PUT', '/tasks/1', body);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, expected);
  }
});

test('PUT /tasks/:id 404s on an unknown id', async () => {
  const { status, body } = await api('PUT', '/tasks/999', { done: true });
  assert.equal(status, 404);
  assert.equal(body.error, 'Task 999 not found');
});

// ---------------------------------------------------------------- delete

test('DELETE /tasks/:id returns 204 with a genuinely empty body', async () => {
  const created = await api('POST', '/tasks', { title: 'Delete me' });
  const { status, raw } = await api('DELETE', `/tasks/${created.body.id}`);
  assert.equal(status, 204);
  assert.equal(raw, '');

  const after = await api('GET', `/tasks/${created.body.id}`);
  assert.equal(after.status, 404);
});

test('DELETE /tasks/:id 404s on an unknown id', async () => {
  const { status, body } = await api('DELETE', '/tasks/999');
  assert.equal(status, 404);
  assert.equal(body.error, 'Task 999 not found');
});

// ---------------------------------------------------------------- queries

test('?done= filters, and rejects anything that is not true or false', async () => {
  const done = await api('GET', '/tasks?done=true');
  assert.equal(done.status, 200);
  assert.ok(done.body.every((task) => task.done === true));

  const bad = await api('GET', '/tasks?done=maybe');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'done filter must be true or false');
});

test('?search= matches on the title and treats % literally', async () => {
  await api('POST', '/tasks', { title: 'Buy 50% cocoa' });

  const hit = await api('GET', '/tasks?search=cocoa');
  assert.equal(hit.status, 200);
  assert.equal(hit.body.length, 1);

  // If % reached LIKE unescaped this would match every task in the table.
  const literal = await api('GET', '/tasks?search=50%25');
  assert.equal(literal.body.length, 1);
  assert.equal(literal.body[0].title, 'Buy 50% cocoa');

  const blank = await api('GET', '/tasks?search=%20');
  assert.equal(blank.status, 400);
  assert.equal(blank.body.error, 'search must not be blank');
});

test('GET /stats counts total, done and open', async () => {
  const { status, body } = await api('GET', '/stats');
  const list = await api('GET', '/tasks');
  assert.equal(status, 200);
  assert.equal(body.total, list.body.length);
  assert.equal(body.done + body.open, body.total);
});

// ---------------------------------------------------------------- errors

test('a malformed JSON body is the client\'s fault, not a 500', async () => {
  const { status, body } = await api('POST', '/tasks', '{oops');
  assert.equal(status, 400);
  assert.equal(body.error, 'request body must be valid JSON');
});

test('an unknown route returns a JSON 404', async () => {
  const { status, body } = await api('GET', '/nope');
  assert.equal(status, 404);
  assert.equal(body.error, 'Cannot GET /nope');
});

// ---------------------------------------------------------------- persistence

test('POST /reset restores the three seed tasks with ids 1, 2, 3', async () => {
  const { status, body } = await api('POST', '/reset');
  assert.equal(status, 200);
  assert.deepEqual(body.map((task) => task.id), [1, 2, 3]);
});

test('data written by one process is visible to the next one', async () => {
  // The test Assignment 1 could never have passed.
  const created = await api('POST', '/tasks', { title: 'Survive a restart' });
  const id = created.body.id;

  await stopServer(server);
  server = await startServer();

  const { status, body } = await api('GET', `/tasks/${id}`);
  assert.equal(status, 200);
  assert.equal(body.title, 'Survive a restart');
});
