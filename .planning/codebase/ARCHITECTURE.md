# Architecture

## Overview

The system is a single-file Node.js HTTP server (`server.js`) that acts as a supervisor and real-time dashboard for an autonomous AI work agent operating on the Moltlaunch marketplace. It has two responsibilities running concurrently:

1. **Subprocess supervisor** — spawns and restarts the `cashclaw-agent` binary, captures all its stdout/stderr, and parses log lines to extract job and earnings state.
2. **HTTP server** — serves a self-contained dashboard HTML page and a set of JSON API endpoints, and pushes real-time updates to browser clients over Server-Sent Events (SSE).

The project has no database. All state is held in memory for the lifetime of the process.

---

## Process Model

```
node server.js  (PORT, default 3777)
  └── cashclaw-agent  (CASHCLAW_PORT = PORT + 1)
```

At startup, before the HTTP server listens, `server.js`:

1. Creates config directories `~/.workclaw/` and `~/.moltlaunch/` and writes `workclaw.json` (agent preferences, pricing, specialties) and `wallet.json` (Ethereum credentials) from environment variables.
2. Patches the `cashclaw-agent` compiled bundle (`node_modules/cashclaw-agent/dist/index.js`) to rewrite its hardcoded port `3777` to `CASHCLAW_PORT`, preventing a port collision when both processes run on the same host.
3. Starts the HTTP server, then immediately calls `startCashclaw()` in the `server.listen` callback.

---

## Request / Response Flow

All HTTP traffic is handled by a single `http.createServer` callback that dispatches on `req.url` (query string stripped):

```
GET /          → DASHBOARD_HTML (text/html, inline template literal)
GET /events    → SSE stream (text/event-stream, keep-alive)
GET /api/*     → JSON responses from in-memory state
```

All JSON responses include `Access-Control-Allow-Origin: *`.

---

## SSE Architecture

The `sseClients` array holds the raw `res` objects for every active `/events` connection. The `broadcast(obj)` function serialises `obj` to a JSON string, wraps it in the SSE `data:` format, and writes it to every client, removing dead connections on write error.

A `setInterval` at 25-second intervals writes SSE comment lines (`:keepalive\n\n`) to all clients to prevent proxy and browser timeout disconnections.

Event types pushed over SSE:

| `type`      | Triggered by              | Payload fields                                      |
|-------------|---------------------------|-----------------------------------------------------|
| `connected` | On SSE handshake          | _(none beyond type)_                                |
| `update`    | Every log line from agent | `totalEarned`, `jobCount`, `newJob`, `newPayment`   |
| `price`     | ETH price poll            | `usd`, `clp`, `updatedAt`                           |
| `market`    | Market intelligence scan  | `agents`, `median`, `ourPrice`, `min`, `max`, `lastScan` |

The browser client reconnects automatically on SSE error with a 5-second delay.

---

## Dashboard HTML — Inline Delivery

`DASHBOARD_HTML` is a template literal embedded directly in `server.js`. It is interpolated once at process start with `AGENT_ID`. On every `GET /` request the same pre-built string is sent.

The browser page:
- Connects to `/events` via `EventSource` for live pushes.
- Performs a parallel `Promise.all` fetch of all five API endpoints on load and on each `update` SSE event (debounced 300 ms via `schedLoad`).
- Caches the last known earnings in `localStorage` to survive page refreshes.
- Requests browser `Notification` permission for new-job and payment alerts.
- Uses `requestAnimationFrame`-based numeric animation for earnings changes.

---

## Market Intelligence Loop

`fetchMarketPrices()` runs at startup and every 30 minutes thereafter. It:

1. Fetches the agent list from `https://api.moltlaunch.com/api/agents`.
2. Filters out the agent's own entry (by `AGENT_ID`) and any prices outside the range 0.00001–1 ETH.
3. Sorts prices, takes the median, then computes a competitive price as `median * 0.90`, clamped to `[PRICE_FLOOR=0.0005, PRICE_CEIL=0.02]`.
4. Writes the updated `baseRateEth` back to `~/.workclaw/workclaw.json` so the running cashclaw subprocess picks it up.
5. Updates the `marketData` object and broadcasts a `market` SSE event.

---

## ETH Price Polling

`fetchEthPrice()` runs at startup and every 5 minutes. It calls the CoinGecko simple-price API for `ethereum` in `usd` and `clp`, updates the `ethPrice` object, and broadcasts a `price` SSE event. The dashboard uses these values to render all ETH amounts in fiat inline.

---

## Cashclaw Subprocess Management

`startCashclaw()` spawns the `cashclaw-agent` binary with `stdio: ['inherit', 'pipe', 'pipe']` so stdin passes through while stdout and stderr are captured. Every non-empty line from either stream is passed to `addLog()`.

On process exit, the supervisor increments `restartCount`, logs a warning, sets `cashclawStatus = 'restarting'`, and schedules `startCashclaw()` again after 15 seconds. There is no backoff — the restart delay is always 15 seconds.

---

## `broadcast()` Pattern

```js
function broadcast(obj) {
  const msg = 'data: ' + JSON.stringify(obj) + '\n\n';
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(msg); }
    catch (e) { sseClients.splice(i, 1); }
  }
}
```

Iterates backwards so splice indices remain valid when dead clients are removed mid-loop. Called from `addLog`, `fetchEthPrice`, and `fetchMarketPrices`.
