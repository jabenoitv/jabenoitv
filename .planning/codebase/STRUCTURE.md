# Structure

## File Layout

```
jabenoitv/
├── server.js          # Entire application — HTTP server, subprocess supervisor, dashboard
├── package.json       # Package manifest; declares cashclaw-agent and moltlaunch dependencies
└── node_modules/
    ├── cashclaw-agent/
    │   └── dist/index.js   # Compiled cashclaw-agent binary (patched at startup)
    └── .bin/
        └── cashclaw        # Executable symlink used by startCashclaw()
```

Runtime directories created by `server.js` at startup:

```
~/.workclaw/
│   workclaw.json      # Agent config: polling intervals, pricing, specialties, LLM settings
~/.moltlaunch/
    wallet.json        # Ethereum wallet address and private key
```

---

## Key Data Structures

### `logs` — `Array<LogEntry>` (max 500 entries, FIFO)

Stores every line emitted by the cashclaw subprocess.

```js
{
  time: string,   // ISO 8601 timestamp
  msg:  string,   // Trimmed log line text
  type: string    // 'info' | 'error' | 'warn'
}
```

### `jobs` — `Array<JobEntry>` (max 100 entries, newest-first)

Automatically populated by `detectJobEvent` parsing log lines.

```js
{
  id:            number,         // Date.now() at detection time
  startTime:     string,         // ISO 8601
  completedTime: string | null,  // ISO 8601, set on completion
  status:        'activo' | 'completado' | 'pagado',
  description:   string,         // Extracted from log line (max 80 chars)
  earnedEth:     number | null   // ETH amount parsed from payment log line
}
```

### `marketData` — Object

Holds the result of the most recent market intelligence scan.

```js
{
  agents:   number,        // Number of competing agents with valid prices
  median:   number,        // Median price in ETH among competitors
  ourPrice: number,        // Computed competitive price (median * 0.90, clamped)
  min:      number,        // Lowest competitor price in ETH
  max:      number,        // Highest competitor price in ETH
  lastScan: string | null  // ISO 8601 timestamp of last successful scan
}
```

### `ethPrice` — Object

```js
{
  usd:       number,        // Current ETH/USD price
  clp:       number,        // Current ETH/CLP price
  updatedAt: string | null  // ISO 8601 timestamp of last successful fetch
}
```

### Other module-level state variables

| Variable             | Type      | Purpose                                              |
|----------------------|-----------|------------------------------------------------------|
| `totalEarnedEth`     | `number`  | Running total of ETH earned (accumulated from logs)  |
| `completedJobsCount` | `number`  | Count of jobs that reached 'completado' status       |
| `lastActivity`       | `string`  | ISO timestamp of the most recent log entry           |
| `cashclawProc`       | `ChildProcess` | Reference to the running cashclaw subprocess    |
| `cashclawStatus`     | `string`  | `'starting'` / `'running'` / `'restarting'`          |
| `restartCount`       | `number`  | Number of times cashclaw has been restarted          |
| `startTime`          | `number`  | `Date.now()` at server start, used for uptime calc   |
| `sseClients`         | `Array`   | Active SSE response objects                          |

---

## Main Functions

### `addLog(line, type)`

Called for every non-empty stdout/stderr line from the cashclaw process. Creates a `LogEntry`, appends it to `logs` (evicting oldest if over `MAX_LOGS=500`), updates `lastActivity`, calls `detectJobEvent`, then broadcasts an `update` SSE event with the current earnings and job count totals.

### `detectJobEvent(line, time)`

Parses a single log line using regex patterns to infer job lifecycle transitions:

- **New job**: matches reception/assignment keywords → `unshift`s a new `JobEntry` with `status: 'activo'` onto `jobs`.
- **Completion**: matches completion/delivery keywords → finds the first active job, sets `status: 'completado'`, records `completedTime`, increments `completedJobsCount`.
- **Payment**: matches an ETH amount near earnings keywords → accumulates `totalEarnedEth`, updates the most recent completed job to `status: 'pagado'`.

### `fetchMarketPrices()`

Fetches `https://api.moltlaunch.com/api/agents`, derives a competitive price, rewrites `~/.workclaw/workclaw.json`, updates `marketData`, and broadcasts a `market` event. Runs every 30 minutes.

### `fetchEthPrice()`

Fetches `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,clp`, updates `ethPrice`, and broadcasts a `price` event. Runs every 5 minutes.

### `broadcast(obj)`

Serialises `obj` as a Server-Sent Events `data:` frame and writes it to every entry in `sseClients`. Dead connections (write errors) are removed in-place during the reverse iteration.

### `startCashclaw()`

Spawns the `cashclaw-agent` binary, pipes stdout/stderr through `addLog`, and registers an `exit` handler that schedules a restart after 15 seconds. Sets `cashclawStatus` to `'running'` on start and `'restarting'` on exit.

### `buildHTML` (inline template — `DASHBOARD_HTML`)

Not a function; a template literal evaluated once at module load. Interpolates `AGENT_ID` into the title and header. Contains all CSS (inline `<style>`), all HTML markup, and all client-side JavaScript (inline `<script>`). Served verbatim on every `GET /` request.

---

## API Endpoints

| Method | Path          | Description                                                                                      |
|--------|---------------|--------------------------------------------------------------------------------------------------|
| `GET`  | `/`           | Serves the full inline dashboard HTML page.                                                     |
| `GET`  | `/events`     | Opens an SSE stream. Sends `{"type":"connected"}` immediately, then live `update`/`price`/`market` events. `:keepalive` comment every 25 s. |
| `GET`  | `/api/status` | Returns agent metadata: `agent`, `wallet`, `uptime` (seconds), `status`, `lastActivity`, `completedJobs`, `totalEarned`, `restarts`. |
| `GET`  | `/api/price`  | Returns current `ethPrice`: `{ usd, clp, updatedAt }`.                                         |
| `GET`  | `/api/market` | Returns current `marketData`: `{ agents, median, ourPrice, min, max, lastScan }`.               |
| `GET`  | `/api/logs`   | Returns the `logs` array (up to 500 entries) as JSON.                                           |
| `GET`  | `/api/jobs`   | Returns `{ jobs, totalEarned, completed, count }`.                                              |

All endpoints set `Access-Control-Allow-Origin: *`. There is no authentication.
