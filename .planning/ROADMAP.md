# Roadmap — CashClaw Dashboard

## Milestone 1: Foundation — COMPLETE
> Railway deployment running, cashclaw-agent subprocess active, basic HTTP dashboard served.

### Phase 1.1: Railway Setup — COMPLETE
- Configure Railway project linked to GitHub `main` branch
- Add required environment variables (agent credentials, RPC endpoints)
- Verify auto-deploy pipeline works on push

### Phase 1.2: Agent Subprocess — COMPLETE
- Install and configure `cashclaw-agent` npm package
- Spawn agent as child process from `server.js`
- Capture and log subprocess stdout/stderr
- Implement auto-restart on unexpected exit

### Phase 1.3: Basic Dashboard — COMPLETE
- Serve a minimal HTML page from `server.js`
- Show agent status (running / stopped)
- Display raw log output from the subprocess

---

## Milestone 2: Real-time Dashboard — COMPLETE
> SSE-driven live updates, ETH price feed, jobs registry with status badges, earnings display with animations.

### Phase 2.1: SSE Infrastructure — COMPLETE
- Implement `/events` SSE endpoint in `server.js`
- Parse subprocess output into structured events
- Client-side EventSource connection with auto-reconnect

### Phase 2.2: ETH Price Feed — COMPLETE
- Fetch ETH/USD from CoinGecko every 5 minutes
- Derive CLP from USD/CLP rate
- Push price updates to all connected SSE clients

### Phase 2.3: Jobs Registry — COMPLETE
- Parse job events from cashclaw-agent output
- Maintain in-memory job list with status tracking
- Render job table with `activo` / `completado` / `pagado` badges
- Trigger browser Notifications API on new job and payment events

### Phase 2.4: Earnings Display — COMPLETE
- Accumulate earnings from payment events
- Show earnings banner in ETH, USD, and CLP
- Flash animation on new payment via CSS + requestAnimationFrame counter
- Persist earnings to localStorage for page-reload survival

---

## Milestone 3: Market Intelligence — COMPLETE
> Competitor price scanner, automated dynamic pricing, price indicator cards with full ETH/USD/CLP display.

### Phase 3.1: Market Scanner — COMPLETE
- Fetch `https://api.moltlaunch.com/api/agents` every 30 minutes
- Calculate median price across all listed agents
- Log scan results and median to server stdout

### Phase 3.2: Dynamic Pricing — COMPLETE
- Set agent price to 10% below computed median
- Enforce floor (0.0005 ETH) and ceiling (0.02 ETH)
- Push price-change event to SSE clients after each adjustment
- Log each adjustment with timestamp, median, and new price

### Phase 3.3: Price Indicator Cards — COMPLETE
- "Precio cobrado" card: current price in ETH, USD, CLP
- "Nuestro precio" card in market section: mirrors current price
- Both cards refresh immediately on SSE price-change event

---

## Milestone 4: Persistence & Reliability — PLANNED
> SQLite for durable earnings and job history across Railway restarts; dashboard authentication.

### Phase 4.1: SQLite Integration — PLANNED
- Add `better-sqlite3` dependency to `package.json`
- Schema: `jobs` table (id, status, amount_eth, timestamp), `earnings` table (total_eth, updated_at)
- Migrate in-memory state to SQLite on startup
- Seed localStorage from SQLite on first dashboard load

### Phase 4.2: State Recovery — PLANNED
- On server restart, reload job history and earnings total from SQLite
- Push full state snapshot to new SSE clients on connect
- Validate localStorage against server state on page load; prefer server truth

### Phase 4.3: Dashboard Authentication — PLANNED
- Add HTTP Basic Auth or Bearer token gate in front of dashboard and `/events`
- Store credential in Railway environment variable
- Return 401 for unauthenticated requests; no credential in client-side code

---

## Milestone 5: Revenue Optimization — PLANNED
> Smarter pricing strategies, job performance analytics, and revenue trend tracking.

### Phase 5.1: Pricing Strategy Engine — PLANNED
- Configurable strategy: median-10%, lowest-competitor, fixed, or time-weighted
- Strategy selection via environment variable (no code change required)
- Back-test new strategy against last N market scans before activating

### Phase 5.2: Job Performance Analytics — PLANNED
- Track job completion rate, average job value, and time-to-payment
- Surface key metrics in a dedicated analytics panel on the dashboard
- Identify job types or time windows with highest revenue density

### Phase 5.3: Revenue Trend Dashboard — PLANNED
- Daily / weekly / monthly earnings chart (Chart.js or lightweight canvas)
- Historical price vs. market median overlay
- Export earnings data as CSV from the dashboard
