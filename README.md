# ChaosServer

A lightweight HTTP chaos/mock server written in TypeScript. It sits in front of (or in place of) a
backend and lets you inject network faults — latency, connection resets, `503 Service Unavailable` —
and return canned responses, either globally or per request via a header.

## Features

- **Configurable latency** — delay every response by a given number of milliseconds.
- **Connection reset injection** — randomly destroy the socket to simulate dropped connections.
- **Unavailable injection** — randomly respond with `503 Service Unavailable`.
- **Mock responses** — return a fixed status code and JSON body.
- **Proxying** — forward matched requests to an upstream target instead of mocking them.
- **Per-request overrides** — pass `x-chaosserver` header to override chaos settings and response.
- **Request history** — the last 50 requests are recorded and can be inspected or cleared.

## Requirements

- Node.js 20+ (the Docker image uses `node:20`)
- npm

## Getting started

```bash
# install dependencies
npm install

# (optional) create a local env file to customise the port
cp .env.example .env

# run in development (ts-node, no build step)
npm start
```

The server reads `PORT` from the environment (falling back to the value in `.env`, then to
**13526**):

```
Mock server running at http://localhost:13526
```

## Building and running

```bash
# compile TypeScript to ./dist
npm run build

# run the compiled output
node ./dist/index.js
```

## Testing

The project uses [Jest](https://jestjs.io/) with `ts-jest` for unit and API tests, and
[supertest](https://github.com/ladjs/supertest) to drive the Express app in-process.
Because `createApp()` returns the app without listening, tests never need to bind port `13526`.

```bash
# run the test suite
npm test

# re-run on change
npm run test:watch

# run with coverage for src/** (index.ts is excluded)
npm run test:coverage
```

The suite covers:

- `FixedSizeQueue` — FIFO order, capacity trimming, dequeue, clear.
- `resolvePort` — `PORT` parsing, defaults, boundaries and invalid values.
- `decideOutcome` — fault selection order and percentage boundaries (deterministic `random`).
- `parseHeaderSettings` / `mergeSettings` — header parsing and partial override merging.
- Admin endpoints — read/replace settings, request history listing and clearing.
- Chaos injection — `503` responses, latency, connection resets, per-request header overrides.
- Proxying — forwarding to an upstream target with the chaos header stripped.

## Docker

```bash
docker build -t chaosserver .
docker run -p 13526:13526 chaosserver

# or publish it on a different port
docker run -e PORT=8080 -p 8080:8080 chaosserver
```

## Environment variables

`PORT` is the only environment variable. It is read by `src/index.ts` via
[dotenv](https://github.com/motdotla/dotenv):

1. the real process environment (e.g. `PORT=8080 npm start`, or Docker/Kubernetes `env`),
2. then `.env` in the project root (copy from `.env.example`),
3. then `DEFAULT_PORT` in `src/config.ts` (`13526`).

`.env` is git-ignored; `.env.example` is committed as a template.

| Variable | Default | Description                                                                                                          |
| -------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `PORT`   | `13526` | TCP port the HTTP server listens on. Must be an integer between `0` and `65535`; any other value fails fast at startup. |

```bash
# .env
PORT=8080
```

```bash
# override the .env value for a single run
PORT=9000 npm start
```

## Configuration

All settings are stored in memory and can be read or replaced at runtime. Defaults:

```json
{
  "configuration": {
    "latency": 200,
    "connectionReset": 1,
    "unavailable": 1
  },
  "response": {
    "status": 200,
    "body": { "success": true }
  }
}
```

| Field             | Type     | Description                                                              |
| ----------------- | -------- | ------------------------------------------------------------------------ |
| `latency`         | `number` | Milliseconds to wait before responding.                                   |
| `connectionReset` | `number` | Percentage chance (0–100) of destroying the connection.                   |
| `unavailable`     | `number` | Percentage chance (0–100) of returning `503 Service Unavailable`.         |
| `proxy`           | `string` | Optional URL. When set, the request is proxied to this target.            |
| `response.status` | `number` | Status code used for mocked responses.                                    |
| `response.body`   | `object` | Body sent for mocked responses.                                           |

## Admin endpoints

| Method   | Path                    | Description                          |
| -------- | ----------------------- | ------------------------------------ |
| `GET`    | `/_internal_/settings`  | Read the current settings.           |
| `POST`   | `/_internal_/settings`  | Replace the current settings (JSON). |
| `GET`    | `/_internal_/requests`  | List the last 50 recorded requests.  |
| `DELETE` | `/_internal_/requests`  | Clear the recorded request history.  |

### Examples

```bash
# read settings
curl http://localhost:13526/_internal_/settings

# set 1000ms latency and force 503s 50% of the time
curl -X POST http://localhost:13526/_internal_/settings \
  -H 'Content-Type: application/json' \
  -d '{"configuration":{"latency":1000,"connectionReset":0,"unavailable":50},"response":{"status":200,"body":{"ok":true}}}'

# inspect request history
curl http://localhost:13526/_internal_/requests

# clear request history
curl -X DELETE http://localhost:13526/_internal_/requests
```

## Per-request overrides

Send an `x-chaosserver` header whose value is a JSON object with the same shape as the stored
settings. Both top-level fields are optional, and whatever you send is merged **over** the stored
settings for that single request — the stored settings themselves are not changed.

```json
{
  "configuration": {
    "latency": 2000,
    "connectionReset": 25,
    "unavailable": 50,
    "proxy": "https://example.com"
  },
  "response": {
    "status": 418,
    "body": { "teapot": true }
  }
}
```

| Header path       | Type                        | Effect for this request                           |
| ----------------- | --------------------------- | ------------------------------------------------- |
| `configuration`   | `ChaosServerConfiguration`  | Overrides `latency` / `connectionReset` / `unavailable` / `proxy`. |
| `response.status` | `number`                    | Status code used for the mocked response.         |
| `response.body`   | `object`                    | Body used for the mocked response.                |

The chaos middleware is mounted with `app.use(...)` and no path, so the header is honoured on
**any** URL and any HTTP method — there are no routes to register first.

```bash
# force a 503 for one request to an arbitrary path
curl http://localhost:13526/v1/orders/42 \
  -H 'x-chaosserver: {"configuration":{"unavailable":100}}'

# arbitrary URL with a query string and a custom mocked response
curl 'http://localhost:13526/some/arbitrary/path?debug=1' \
  -H 'x-chaosserver: {"response":{"status":200,"body":{"ok":true,"path":"/some/arbitrary/path"}}}'

# 2s latency + 25% chance of a connection reset for this request
curl http://localhost:13526/api/ping \
  -H 'x-chaosserver: {"configuration":{"latency":2000,"connectionReset":25},"response":{"status":418,"body":{"teapot":true}}}'

# latency only (everything else stays as configured)
curl http://localhost:13526/api/ping \
  -H 'x-chaosserver: {"configuration":{"latency":500}}'

# POST with a body — same header, other methods behave identically
curl -X POST http://localhost:13526/api/orders \
  -H 'Content-Type: application/json' \
  -H 'x-chaosserver: {"configuration":{"latency":0,"unavailable":100}}' \
  -d '{"id":1}'

# PUT / PATCH / DELETE too
curl -X DELETE http://localhost:13526/api/orders/1 \
  -H 'x-chaosserver: {"response":{"status":200,"body":{"deleted":true}}}'

# drop the connection for this request (100% => deterministic)
curl http://localhost:13526/api/ping \
  -H 'x-chaosserver: {"configuration":{"connectionReset":100}}'
# curl: (52) Empty reply from server

# proxy this request to an upstream service (the header is stripped before forwarding)
curl http://localhost:13526/api/ping \
  -H 'x-chaosserver: {"configuration":{"proxy":"https://example.com"}}'
```

The same header from other clients:

```js
// Node.js (fetch)
await fetch('http://localhost:13526/v1/orders/42', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-chaosserver': JSON.stringify({ configuration: { latency: 0, unavailable: 100 } }),
  },
  body: JSON.stringify({ id: 1 }),
});
```

```bash
# httpie
http POST localhost:13526/v1/orders/42 id:=1 'x-chaosserver:{"configuration":{"unavailable":100}}'
```

In Postman / Insomnia, add a header named `x-chaosserver` with the JSON object as its value.

### Things to know

- The override applies **only** to the request carrying the header.
- A missing, malformed or non-object header (e.g. `42`) is ignored and the stored settings are used.
- When a connection reset is injected the client sees a dropped socket instead of a status code
  (`curl: (52) Empty reply from server`, exit code `52`) — that is the injected fault, not a crash.
  Because of this, an example with a partial percentage (e.g. `"connectionReset":25`) will fail
  roughly a quarter of the time by design.
- `unavailable` is rolled before `connectionReset`, so `{"unavailable":100,"connectionReset":100}`
  always returns `503` — never a reset.
- `x-chaosserver` is stripped from the request before it is proxied upstream.
- The admin endpoints (`/_internal_/*`) ignore the header entirely, so you can always read or
  repair the settings even if you send bad overrides.

## Project structure

```
.
├── .dockerignore
├── .env.example                # copy to .env to change PORT
├── Dockerfile
├── jest.config.js
├── package.json
├── tsconfig.json               # build config (excludes *.test.ts)
├── tsconfig.test.json          # test config used by ts-jest
└── src
    ├── index.ts                # entry point: loads .env, resolves PORT, listens
    ├── app.ts                  # createApp() factory, routes and chaos logic
    ├── app.test.ts             # API + chaos behaviour tests
    ├── config.ts               # environment parsing (resolvePort)
    ├── config.test.ts
    ├── types.ts                # shared configuration/settings types
    └── commons
        ├── fixedSizeArray.ts   # FixedSizeQueue used for request history
        └── fixedSizeArray.test.ts
```

### Programmatic use

`createApp()` builds a fully configured Express app without starting a listener, so it can be
mounted in tests or embedded in another process:

```ts
import { createApp } from './app';
import { resolvePort } from './config';

// latency 0 so tests are fast, no random faults
const { app, storage } = createApp({
    settings: { configuration: { latency: 0, connectionReset: 0, unavailable: 0 } },
    requestHistorySize: 50,
});

app.listen(resolvePort(process.env.PORT));
console.log(storage.settings);
```

## Notes

- Settings and request history are kept **in memory** and reset when the server restarts.
- Request history is capped at 50 entries (see `FixedSizeQueue` in `src/commons/fixedSizeArray.ts`).
- Intended for testing and development environments only — do not expose a chaos server in production.

## License

ISC
