# Technical Concerns & Risks

> Codebase: `jabenoitv-cashclaw` — `server.js` (single-file Node.js agent dashboard)
> Generated: 2026-05-24

---

## 1. Security

### [HIGH] Private key written to disk on every startup

`server.js` lines 35–38 write `WALLET_PRIVATE_KEY` from the environment into `~/.moltlaunch/wallet.json` on the filesystem at startup. Any process with access to the home directory can read the unencrypted private key. A crash, a misconfigured file-permission, or a log-rotation tool that archives dotfiles could expose it.

**Recommendation:** Pass the private key to cashclaw-agent in-memory only (via stdin or a named pipe), or use a secrets manager / hardware wallet abstraction. Never persist the raw private key to disk.

### [HIGH] No authentication on dashboard or API endpoints

All HTTP endpoints (`/`, `/api/status`, `/api/logs`, `/api/jobs`, `/api/market`, `/api/price`, `/events`) respond to any unauthenticated request. `WALLET_ADDRESS` is exposed in `/api/status`. Logs — which may contain job descriptions or payment amounts — are fully public to anyone who can reach the port.

**Recommendation:** Add at minimum a shared-secret token in an `Authorization` header, enforced by middleware before any route handler. A simple Bearer-token check derived from a `DASHBOARD_SECRET` env var would suffice.

### [HIGH] `local-setup.sh` must never be committed

`local-setup.sh` is gitignored, but it presumably contains secrets (private key, API keys). The `.gitignore` rule must be verified to cover all variants (`local-setup*.sh`, `*.local.sh`). A accidental `git add -f` would expose credentials in history permanently.

**Recommendation:** Add a pre-commit hook that fails if any file containing `PRIVATE_KEY` or `ANTHROPIC_API_KEY` literal assignments is staged.

### [MEDIUM] CORS wildcard on all API routes

Every API response includes `Access-Control-Allow-Origin: *`. This allows any webpage the user visits to make cross-origin requests to the dashboard and read wallet addresses, earnings, and logs.

**Recommendation:** Restrict to a specific origin (e.g. `http://localhost:PORT`) or remove the CORS header if the dashboard is only ever accessed locally.

---

## 2. Reliability

### [HIGH] `totalEarnedEth` and `completedJobsCount` are in-memory only

Both counters reset to zero on every process restart. Given that cashclaw exits and is restarted automatically (every crash increments `restartCount`), earnings history is permanently lost each time. The dashboard's `localStorage` cache in the browser partially masks this, but it is per-browser and not authoritative.

**Recommendation:** Persist `totalEarnedEth` and `completedJobsCount` to a file (e.g. `~/.workclaw/state.json`) and load on startup. SQLite would be more robust for job records.

### [HIGH] Job detection relies entirely on regex heuristics against log strings

`detectJobEvent()` (lines 162–182) uses brittle regular expressions against free-form cashclaw log output. Any log message rewording, locale change, or log-level prefix added by cashclaw will silently break job/payment detection. There is no acknowledgement mechanism — a matched "completed" line with no prior "received" line creates orphaned state.

**Recommendation:** cashclaw-agent should expose a structured event API (webhook callback, named pipe, or IPC channel). Log-scraping should be a fallback of last resort, not the primary integration point.

### [MEDIUM] `jobs` array state can become inconsistent across restarts

The `jobs` array is rebuilt from scratch on each server start. A job that was "activo" when the process crashed will never be transitioned to "completado" or "pagado" in subsequent sessions.

**Recommendation:** Persist job records to disk and reload on startup, filtering orphaned "activo" jobs older than a configurable timeout to "unknown" status.

### [LOW] ETH price fetch has no retry or fallback

If the CoinGecko request fails (network error, rate limit, API change), `ethPrice` stays at `{ usd: 0, clp: 0 }` indefinitely until the next 5-minute interval. Fiat displays silently show zero.

**Recommendation:** Cache the last known good price persistently, and surface a visible stale-data warning after N consecutive failures.

---

## 3. Scalability

### [MEDIUM] Single-file `server.js` is 558 lines and growing

All concerns — config generation, cashclaw port patching, SSE broadcast, ETH price polling, market scanning, log/job state, HTTP routing, and the entire dashboard HTML — are colocated in one file. This makes it increasingly difficult to test, modify, or reason about individual subsystems in isolation.

**Recommendation:** Split into focused modules:
- `lib/config.js` — workclaw.json / wallet.json generation
- `lib/cashclaw.js` — process management and log ingestion
- `lib/market.js` — market scanner and price logic
- `lib/state.js` — in-memory state, persistence, and getters
- `lib/sse.js` — SSE client management and broadcast
- `routes/api.js` — HTTP route handlers
- `dashboard/index.html` — served as a static file (eliminates template-literal nesting risk)

### [MEDIUM] All runtime state is held in process memory

`logs` (max 500), `jobs` (max 100), `ethPrice`, `marketData`, `totalEarnedEth`, `completedJobsCount` are all plain JS variables. There is no persistence, no sharing between multiple instances, and no graceful-shutdown flush. A `SIGKILL` or OOM kill loses all state silently.

**Recommendation:** Add a `process.on('SIGTERM')` / `process.on('SIGINT')` handler that flushes state to disk before exiting.

### [LOW] No dependency version pinning

`package.json` specifies `cashclaw-agent: "^0.1.0"` (minor-range) and `moltlaunch: "latest"`. A publisher pushing a breaking or malicious update to either package will silently break or compromise the agent on next `npm install`.

**Recommendation:** Pin to exact versions (`"0.1.0"`) and commit a `package-lock.json`. Review updates deliberately.

---

## 4. Known Bugs & Fragile Patterns

### [HIGH] Cashclaw port patching depends on exact compiled string `"var PORT = 3777;"`

Lines 48–53 read the cashclaw dist bundle and do a string replacement to change its listen port. If the bundler minifies differently, renames the variable, or the string is split across lines, the replacement silently fails and both cashclaw and the dashboard attempt to bind the same port, causing one or both to crash. The patch also mutates `node_modules`, which is overwritten on `npm install`.

**Recommendation:** Check whether cashclaw-agent supports a `PORT` environment variable or a config-file option. If not, contribute that feature upstream. As a fallback, detect if the patched string is present *after* writing and log a clear error if not.

### [HIGH] Template-literal nesting constraint in `DASHBOARD_HTML`

The entire dashboard HTML is a Node.js template literal (lines 223–515). The `<script>` block inside it must never use backtick characters, because an unescaped backtick would terminate the outer template literal and cause a syntax error or a runtime JS parse failure. This is a silent footgun for anyone adding frontend code. The existing workaround (`<\/script>`) shows awareness of the issue but the backtick rule is undocumented.

**Recommendation:** Move dashboard HTML to a static file (`dashboard/index.html`) and serve it with `fs.readFileSync`. This eliminates the constraint entirely and enables standard editor tooling for the HTML/JS.

### [MEDIUM] Market scanner updates `workclaw.json` but cashclaw may not reload it

`fetchMarketPrices()` (line 97) updates `~/.workclaw/workclaw.json` with a new `baseRateEth` every 30 minutes. However, cashclaw reads its config at startup; if it does not hot-reload the file, the price change has no effect until the process restarts. The restart interval (crash-driven) is non-deterministic.

**Recommendation:** Confirm whether cashclaw-agent watches the config file for changes. If not, either trigger a controlled cashclaw restart after a price update, or find an IPC mechanism to push the new price directly.

### [LOW] `em[1]` ETH regex in dashboard `<script>` uses `\\s*` instead of `\s*`

Line 489 of the dashboard HTML script block: `var em=msg.match(/([0-9.]+)\\s*ETH/);`. Inside the template literal, `\\s` is a literal backslash-s in the string, which at runtime becomes the regex `[0-9.]+\s*ETH`. This happens to work because `\s` in a regex character class still matches whitespace, but it is an unintentional double-escape that will confuse anyone who reads or modifies the regex.

**Recommendation:** Keep it as a documented quirk, or migrate to a static HTML file where the regex is written normally.

---

## 5. Future Improvements

### [MEDIUM] Add a persistence layer (SQLite or JSON file store)

Replace all in-memory state with a lightweight persistence layer. SQLite via `better-sqlite3` is a zero-config option that supports job history, cumulative earnings, and log replay across restarts.

### [MEDIUM] Add authentication to the dashboard

Implement a simple password or token-based auth gate before any route is served. A single `DASHBOARD_PASSWORD` env var hashed to a session cookie is sufficient for a single-operator dashboard.

### [MEDIUM] Split `server.js` into modules

See Scalability section above. This is the highest-leverage refactor for long-term maintainability.

### [LOW] Add a proper test suite

There are currently no tests. At minimum, unit tests for `detectJobEvent()` (the most fragile function) and integration tests for the HTTP routes would provide a safety net for future changes.

### [LOW] Add webhook/IPC callback from cashclaw instead of log parsing

Request or contribute a structured event emission API in cashclaw-agent (e.g. a callback URL, IPC messages, or a local event webhook). This would replace the regex log-scraping approach with a reliable, versioned contract.

### [LOW] Add `process.on('SIGTERM')` graceful shutdown with state flush

Ensure that a controlled deployment restart (e.g. via Railway, Render, or systemd) flushes accumulated earnings and job state to disk before the process exits, preventing data loss on routine redeploys.
