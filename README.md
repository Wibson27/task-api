# Task API

A REST API that manages a to-do list, running against PostgreSQL in Docker. The
whole stack — the app and its database — starts with one command.

Built for the FlyRank internship, Backend track. This repository is the same
project across three assignments, and the API contract has not changed once:

| | Where tasks live | What runs it | Survives |
|---|---|---|---|
| **A1** | an array in memory | the Node process | nothing |
| **A2** | a `tasks.db` file | SQLite, in-process | a process restart |
| **A3** (here) | rows in Postgres | a container | `docker compose down` |

The A2 version is still runnable at the [`a2-sqlite`](../../tree/a2-sqlite) tag.

## Run it

```bash
cp .env.example .env
docker compose up
```

That is the whole setup. Compose builds the API image, starts Postgres, waits
for it to become healthy, then starts the app, which creates the table and seeds
three example tasks on first run.

- API — http://localhost:3000
- Interactive docs — http://localhost:3000/docs
- Postgres — `localhost:5432`, database `tasks`, user `postgres`

```bash
docker compose up -d        # in the background
docker compose logs -f api  # follow the app's logs
docker compose down         # stop, keeping the data
docker compose down -v      # stop and destroy the data too
```

### Configuration

All configuration is environment variables. `.env` is git-ignored;
`.env.example` is committed so you know which keys to set.

| Variable | Used by | Example |
|---|---|---|
| `DATABASE_URL` | the app | `postgres://postgres:dev@localhost:5432/tasks` |
| `PORT` | the app | `3000` |
| `POSTGRES_PASSWORD` | compose, for both services | `dev` |

The host differs depending on where the app runs. On your machine against the
container it is `localhost`; inside compose it is `db`, the service name —
each container has its own `localhost`, so the service name is how they find
each other. Compose sets `DATABASE_URL` itself, so you never edit it for that.

### Running the app outside Docker

Useful while developing. Start only the database in a container:

```bash
docker compose up -d db
npm install
npm start
```

## Endpoints

Identical to A1 and A2. Only the storage behind them changed.

| Method | Path | Purpose | Success | Errors |
|---|---|---|---|---|
| GET | `/` | What this API is | 200 | — |
| GET | `/health` | Liveness — including the database | 200 | 503 if the database is unreachable |
| GET | `/tasks` | List tasks | 200 | 400 invalid query |
| GET | `/tasks/:id` | Get one task | 200 | 404 unknown id |
| POST | `/tasks` | Create a task | 201 | 400 invalid body |
| PUT | `/tasks/:id` | Update a task | 200 | 400 invalid body, 404 unknown id |
| DELETE | `/tasks/:id` | Delete a task | 204 | 404 unknown id |
| GET | `/stats` | Counts of total / done / open | 200 | — |
| POST | `/reset` | Restore the three seed tasks | 200 | — |

A task on the wire:

```json
{ "id": 1, "title": "Finish DSA assignment", "done": false }
```

### Query parameters on `/tasks`

| Parameter | Example | SQL behind it |
|---|---|---|
| `done` | `/tasks?done=true` | `WHERE done = $1` |
| `search` | `/tasks?search=memory` | `WHERE title ILIKE $1` |
| `sort` | `/tasks?sort=title` | `ORDER BY lower(title)` |

`%` and `_` in a search term are escaped before they reach `ILIKE`, so searching
for `50%` finds that literal text rather than matching every row.

### Validation rules

Unchanged. `POST` needs a non-empty `title`; `PUT` needs at least one of `title`
or `done`, with `done` a real boolean rather than the string `"true"`; titles are
trimmed; the client never chooses `id` or the initial `done`; a body that is not
valid JSON returns 400; and a non-numeric id returns 404 rather than an error.

## A full lifecycle, via curl

```text
$ curl -i -X POST http://localhost:3000/tasks \
    -H "Content-Type: application/json" \
    -d '{"title":"Review pointer arithmetic notes"}'
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{"id":4,"title":"Review pointer arithmetic notes","done":false}

$ curl -i -X PUT http://localhost:3000/tasks/4 \
    -H "Content-Type: application/json" -d '{"done":true}'
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"id":4,"title":"Review pointer arithmetic notes","done":true}

$ curl -i -X DELETE http://localhost:3000/tasks/4
HTTP/1.1 204 No Content

$ curl -i http://localhost:3000/tasks/4
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8

{"error":"Task 4 not found"}
```

Full transcript: [docs/curl-session.txt](docs/curl-session.txt).

## The data in the database

Opened with `psql` inside the running container — the same rows the API serves:

```bash
docker compose exec db psql -U postgres -d tasks
```

![The tasks table in psql](docs/psql.png)

## Schema

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id         SERIAL      PRIMARY KEY,
  title      TEXT        NOT NULL,
  done       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks (done);
```

`done` is a real `BOOLEAN` here. SQLite had no boolean type and handed back `0`
and `1`, so A2 needed a mapping function to keep the API's responses honest.
Postgres has the type and the driver returns a JavaScript boolean, so that
mapping simply disappeared — the stricter database does work the application
used to do.

`created_at` and `updated_at` are stored but deliberately not returned by the
API, exactly as in A2: adding fields would change response shapes the earlier
assignments promised to keep.

Adding those two columns was also far easier here. SQLite rejects
`ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP` because the default must be constant,
so A2 needed a three-step add-backfill-populate migration. Postgres accepts a
non-constant default and backfills existing rows itself.

## Every query is parameterized

No user input is ever concatenated into SQL. Values travel to Postgres separately
from the SQL text, as numbered placeholders:

```js
await pool.query('SELECT id, title, done FROM tasks WHERE id = $1', [id]);
```

An id of `1; DROP TABLE tasks` is looked up as a meaningless string rather than
executed. The one place SQL text is assembled in JavaScript is the optional
`WHERE` clause on `/tasks`, and there only fixed fragments the storage layer owns
are concatenated — the values still bind.

## Secrets

`.env` holds the database password and is git-ignored. `.env.example` carries the
same keys with placeholder values and is committed.

```bash
$ git check-ignore -v .env
.gitignore:7:.env    .env

$ git log --all --pretty=format: --name-only | sort -u | grep -x '.env'
(no output — .env appears in no commit)
```

`.env` is also in `.dockerignore`, so it never enters the build context and
cannot end up baked into an image that gets pushed to a registry.

## Persistence, proven

Tasks created through the stack, then both containers destroyed and recreated:

```text
$ curl -X POST .../tasks -d '{"title":"Survive docker compose down"}'
{"id":4,"title":"Survive docker compose down","done":false}
$ curl .../stats
{"total":5,"done":1,"open":4}

$ docker compose down
 Container a1-task-api-db-1  Removed
 Network a1-task-api_default  Removed

$ docker compose up -d
 Container a1-task-api-db-1  Healthy
 Container a1-task-api-api-1  Started

$ curl .../tasks
5 tasks:
  1  Finish DSA assignment
  2  Email academic advisor
  3  Read chapter on virtual memory
  4  Survive docker compose down
  5  Prove the volume works

$ docker compose logs api
api-1  | Existing tasks found, skipping seed
```

Brand-new containers, same data — because the named volume outlived them, and
the seed guard correctly found a populated table.

### Why a volume is not optional

Running Postgres with no volume at all, creating rows, then removing the
container and starting a fresh one:

```text
rows before:  1  I have no volume
              2  I will not survive

$ docker rm -f nodb && docker run --name nodb ... postgres:18

rows after:   ERROR:  relation "tasks" does not exist
```

Not just the rows — the table. A container's filesystem is a layer deleted with
the container, and Postgres had written its whole data directory into it. Full
notes in [docs/postgres-notes.txt](docs/postgres-notes.txt).

## Proof the API did not change

`test/api.test.js` describes the contract from A1 — the endpoints, the status
codes, the exact key set of every response body.

```
$ npm test
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

The same suite passed against an array, against a SQLite file, and now against a
Postgres server in a container. Three storage engines, one unchanged contract.
That is what "storage is an implementation detail" means, stated as something
executable rather than as a claim.

One assertion was widened: `/health` now runs a real query and reports `db: "ok"`,
so its body carries a field it did not have before. `/health` is an operational
endpoint, not one of the five CRUD endpoints whose shapes the assignment pins —
and a health check that never touches its database is not a health check.

### Two places the swap genuinely leaked

Worth being honest about, because both contradict the tidy version of the story.

**Synchronous became asynchronous.** `better-sqlite3` is an in-process library
reading a local file, so its calls return values. `pg` talks to another process
over a socket, so every call returns a promise. Every route handler became
`async` and every store call needed `await`. No amount of layering hides that,
because it changes the type every caller sees — and A15's layered architecture
will not fix it either.

**Postgres is stricter about types.** `GET /tasks/abc` makes `Number('abc')`
into `NaN`. SQLite matched no row and returned 404. Postgres rejects `NaN` for an
integer column, so the driver threw and the request became a **500** — a server
error for a client mistake. The contract tests caught it on the first run against
Postgres; the fix was to parse the id in the HTTP layer before it reaches the
database.

That second one is the argument for the test suite in one paragraph. The bug was
invisible to every manual check, and a test written for A1 found it in A3.

## What a load balancer does with `/health`

It polls it every few seconds and uses the answer to decide whether to keep
sending traffic to this instance. A 200 means "in rotation"; repeated failures
mean the instance is pulled out and requests go to healthy ones instead. That is
why `/health` returns **503** rather than 200 when the database is unreachable —
an instance that cannot reach its database can still accept TCP connections and
answer, so a check that only proves the process is alive would keep routing real
users into failures.

## Image size

| Build | Size |
|---|---|
| Single-stage | 272 MB |
| Multi-stage | 258 MB |

A 14 MB saving, about 5%, and worth being straight about why it is small: 237 MB
of that image is the `node:24-alpine` base and only 17.4 MB is `node_modules`.
What multi-stage leaves behind here is npm's cache. It pays off dramatically when
the build produces something much smaller than its inputs — a compiled binary, a
bundled front-end, native modules needing a compiler to install but not to run.
Here the dependencies are pure JavaScript, so the real lever would be a smaller
base image, not a smarter build.

The multi-stage Dockerfile is kept for a second reason regardless: it ends with
`USER node`, so the app does not run as root inside its container.

## Project layout

```
index.js           HTTP layer — routes, validation, status codes. Knows no SQL.
db.js              Storage layer — the only file that knows SQL exists.
compose.yaml       The two services, the network, the volume, the healthcheck.
Dockerfile         Multi-stage build for the api image.
.dockerignore      Keeps node_modules, .git and .env out of the build context.
.env.example       The keys to set. The real .env is git-ignored.
openapi.json       The OpenAPI 3.0 description Swagger UI renders.
test/api.test.js   The A1 contract, asserted against Postgres.
docs/              Screenshots, transcripts, and the measurements above.
```

`db.js` is the file that changed for this assignment. It has now been rewritten
three times — array, SQLite, Postgres — while `index.js` kept the same routes,
the same validation, and the same status codes throughout. Formalizing that
boundary into explicit layers is A15; the discipline it depends on starts here.
