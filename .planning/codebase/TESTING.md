# Testing

## Current Status

There is no automated test suite. `package.json` defines no `test` script, no test dependencies (Jest, Mocha, etc.), and no `test/` or `__tests__/` directory. The project runs as a single `server.js` entry point with no testable module exports.

## Manual Verification Checklist

Use this checklist after any change to confirm the app is healthy.

### 1. Deployment / Process Start

- Deploy to Railway (or run `node server.js` locally with required env vars set).
- Check Railway logs (or terminal output) for the startup sequence:
  - `Config ready. AgentId: <ID>` — workclaw config written successfully.
  - `Cashclaw parcheado: puerto <PORT+1>` — cashclaw port patching succeeded (or `No se pudo parchear cashclaw:` if already patched / binary absent).
  - `Precio ETH: $<N> USD` — first ETH price fetch completed.
  - `Dashboard listo en http://0.0.0.0:<PORT>` — HTTP server is up.
  - Cashclaw subprocess output begins appearing.

### 2. Dashboard UI

- Open `https://<your-railway-url>/` in a browser.
- Verify the page loads without a blank screen or JS error in the browser console.
- Check the header shows the correct Agent ID (`#<AGENT_ID>`).
- The "Ganancias totales" banner should show `0.000000 ETH` (or a cached value from `localStorage`).
- The status card should transition from `...` to `running` within a few seconds.
- The uptime counter (`Activo`) should increment every time the page refreshes or SSE triggers a reload.

### 3. SSE Connection

- Open DevTools > Network tab > filter by `EventSource` or by `/events`.
- Confirm a persistent connection to `/events` is established (status `200`, type `eventsource`).
- The live dot (`.ldot`) in "Actividad reciente" should turn green and pulse.
- The `earn-ts` text should change from `conectando...` to `en vivo`.
- Wait 25 seconds — a `:keepalive` comment frame should appear in the EventSource stream, confirming the heartbeat is working.

### 4. API Endpoints

Hit each endpoint directly and confirm valid JSON is returned:

| Endpoint | Expected keys |
|---|---|
| `/api/status` | `agent`, `wallet`, `uptime`, `status`, `lastActivity`, `completedJobs`, `totalEarned`, `restarts` |
| `/api/price` | `usd`, `clp`, `updatedAt` |
| `/api/market` | `agents`, `median`, `ourPrice`, `min`, `max`, `lastScan` |
| `/api/logs` | Array of `{ time, msg, type }` objects |
| `/api/jobs` | `{ jobs, totalEarned, completed, count }` |

### 5. ETH Price Update

- Wait up to 5 minutes (or restart the server to trigger an immediate fetch).
- Check Railway logs for `Precio ETH: $<N> USD`.
- In the dashboard, `earn-ts` should update to `1 ETH = $<N> USD - actualizado <time>`.
- The "Nuestro precio" and "Precio cobrado" cards should show fiat equivalents once `ethUsd > 0`.

### 6. Market Scanner

- Check Railway logs for `Mercado escaneado: <N> agentes | mediana <X> ETH | nuestro precio <Y> ETH`.
- In the dashboard, the "Inteligencia de Mercado" section should populate all four cards (Mediana, Nuestro precio, Posicion, Rango).
- The "escan." timestamp in the section header should update.
- The scan repeats every 30 minutes — verify a second scan appears in logs.

## Regression Tests Worth Adding

The following test scenarios would catch the most common regressions if a test suite is added later.

### SSE Reconnect

- Scenario: the SSE connection drops (server restart, network blip) and the browser automatically reconnects.
- What to verify: `connectSSE()` is called again after the 5-second delay; the live dot turns green again; the dashboard resumes updating.
- Regression risk: any change to `es.onerror` handler or the `sseClients` splice logic could break auto-reconnect.

### Market Scanner: Competitive Pricing Calculation

- Scenario: given a known array of agent prices, the computed `competitive` price equals `median * 0.90` clamped to `[PRICE_FLOOR, PRICE_CEIL]`.
- Edge cases: empty price array (should log "sin datos" and return early without writing the config file); all prices outside the 0.00001–1 filter range; single-agent market.
- Regression risk: changes to the `prices.filter` or `Math.max/min` clamp logic.

### ETH Price Flash Animation

- Scenario: when a new payment is received (`totalEarnedEth` increases), the earnings banner plays the `flash-earn` CSS animation.
- What to verify: `flashBanner()` calls `classList.remove('flash')`, forces a reflow via `void b.offsetWidth`, then adds `'flash'` back — any shortcut that skips the reflow will break re-triggering the animation on consecutive payments.
- Regression risk: refactoring `flashBanner` or the `updateEarnings` call path.

### Job Detection via Log Parsing

- Scenario: `detectJobEvent(line, time)` correctly identifies job-received, job-completed, and payment lines from cashclaw stdout.
- Test cases:
  - Line matching `task.*receiv` regex → new job pushed to `jobs[]` with `status: 'activo'`.
  - Line matching `complet` regex → earliest active job transitions to `'completado'`.
  - Line containing `0.005 ETH` + `earn` keyword → `totalEarnedEth` incremented, job transitions to `'pagado'`.
  - Line that matches none of the above → no side effects.
- Regression risk: the regex patterns are the sole mechanism for job tracking; tightening or loosening them changes what gets counted as revenue.

### Dashboard HTML Script Block: No Backticks

- Scenario: ensure no backtick characters appear inside the `<script>` ... `<\/script>` section of `DASHBOARD_HTML`.
- This can be verified with a simple grep/regex test on the source file: extract the script section and assert it contains no `` ` `` characters.
- Regression risk: a developer adds a template literal inside the script block during editing, which silently changes runtime behavior in older browsers or causes string-escaping issues when the HTML is served as a raw string.

### Cashclaw Port Patch (Idempotency)

- Scenario: the dist file patching runs on startup; if deployed twice, the second run should detect the port is already replaced and skip the write.
- Verified by the `if (src.includes('var PORT = 3777'))` guard — a test could assert `fs.writeFileSync` is not called when the guard condition is false.

### Ring Buffer Caps

- Scenario: adding more than `MAX_LOGS = 500` log entries should cause the oldest to be evicted (via `logs.shift()`), keeping `logs.length <= 500`.
- Scenario: adding more than `MAX_JOBS = 100` jobs should cause the oldest to be evicted (via `jobs.pop()`).
