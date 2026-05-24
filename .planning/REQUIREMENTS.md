# Requirements — CashClaw Dashboard

## Functional Requirements

### FR-01: Real-time Event Stream
- Dashboard must receive live updates from the server via SSE (Server-Sent Events)
- No polling allowed; all live data flows through a single `/events` SSE endpoint
- Client must auto-reconnect on connection loss

### FR-02: ETH Price Feed
- Fetch ETH/USD price from CoinGecko API every 5 minutes
- Derive CLP equivalent from ETH/USD using a fixed or live USD/CLP rate
- Display current ETH price in the dashboard header/earnings section

### FR-03: Earnings Display
- Show total cumulative earnings in ETH, USD, and CLP
- Earnings banner must flash/animate on new payment receipt
- Use requestAnimationFrame for smooth counter animations
- Earnings must persist across page reloads via localStorage

### FR-04: Jobs Registry
- Display job history with per-job status badges: `activo`, `completado`, `pagado`
- Each job entry must show job ID, timestamp, amount, and current status
- New job events must trigger a browser notification (Notifications API)

### FR-05: Market Intelligence — Price Scanner
- Fetch all agents from `https://api.moltlaunch.com/api/agents` every 30 minutes
- Calculate median price across all listed agents
- Automatically set our agent's price to 10% below the median
- Enforce floor: 0.0005 ETH, ceiling: 0.02 ETH
- Log each price adjustment event with timestamp and rationale

### FR-06: Price Indicator Cards
- "Precio cobrado" card: display current agent price in ETH, USD, and CLP
- "Nuestro precio" card (market section): mirror current price in ETH, USD, and CLP
- Both cards must update immediately after any price adjustment event

### FR-07: Agent Subprocess Management
- server.js must spawn `cashclaw-agent` npm package as a child process
- Capture stdout/stderr from the subprocess and pipe relevant events to SSE
- Restart subprocess automatically on unexpected exit

---

## Non-Functional Requirements

### NFR-01: Performance
- SSE endpoint must support at least 1 concurrent connection with < 100ms event latency
- Market scanner must not block the main event loop; run asynchronously
- Dashboard page must load in under 3 seconds on a standard broadband connection

### NFR-02: Reliability
- server.js is a single file; no complex build step required for deployment
- Subprocess crash must not crash the Node.js server process
- ETH price fetch failure must degrade gracefully (show last known price, not an error state)
- Moltlaunch API fetch failure must preserve the last known price without triggering a reset

### NFR-03: Security
- Dashboard must not expose Railway environment variables or private keys to the browser
- No sensitive agent credentials may appear in SSE event payloads
- (Milestone 4) HTTP Basic Auth or token-based auth gate on the dashboard

### NFR-04: Observability
- All price adjustment events logged to server stdout with timestamp
- Subprocess lifecycle events (start, crash, restart) logged to server stdout
- ETH price fetch errors logged with reason

---

## Constraints

### C-01: Railway Free Tier
- Single dyno; no persistent filesystem between deploys (mitigated by localStorage in browser, SQLite planned for Milestone 4)
- Memory limit applies; no in-memory caching of unbounded job history
- Deploy triggers from GitHub `main` branch push

### C-02: Base Blockchain (Chain 8453)
- All on-chain interactions use Base L2 (Coinbase)
- Agent ID 51049 is registered on the Moltlaunch marketplace; no chain switching

### C-03: Moltlaunch API
- Price and job data sourced from `https://api.moltlaunch.com/api/agents`
- API is external and uncontrolled; rate limits and availability are not guaranteed
- Price-setting mechanism depends on Moltlaunch API accepting price update calls

### C-04: Single-file Architecture
- All server logic lives in `server.js`; no bundler, no transpilation
- Frontend is served inline or as static files from the same process
- Node.js runtime only; no Deno, Bun, or non-standard runtimes
