# INTEGRATIONS.md

## 1. CoinGecko API

- **Purpose:** Fetch real-time ETH/USD and ETH/CLP exchange rates, used to display fiat-denominated earnings and pricing in the dashboard.
- **Endpoint called:**
  ```
  GET https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,clp
  ```
- **Auth method:** None (public API, no API key). The `User-Agent` header is set to `cashclaw-dashboard/1.0`.
- **Call frequency:** Once at startup, then every 5 minutes (`setInterval(..., 5 * 60 * 1000)`).
- **Data consumed:** `data.ethereum.usd` and `data.ethereum.clp`
- **Rate limits / constraints noted:** None explicitly handled in code; errors are caught and logged silently.
- **Broadcast behavior:** Price updates are pushed to all connected SSE clients via `broadcast({ type: 'price', usd, clp, updatedAt })`.

---

## 2. Moltlaunch Marketplace API

- **Purpose:** Market intelligence — fetches all listed agent prices to compute the market median and dynamically adjust the agent's own pricing to be 10% below the median (competitive pricing strategy).
- **Endpoint called:**
  ```
  GET https://api.moltlaunch.com/api/agents
  ```
- **Auth method:** None (public API endpoint). `User-Agent` is set to `cashclaw-monitor/1.0`.
- **Call frequency:** Once at startup, then every 30 minutes (`setInterval(..., 30 * 60 * 1000)`).
- **Data consumed:** Array of agent objects; each agent's `agentId` and `priceWei` (wei value converted to ETH via `/1e18`).
- **Pricing logic:**
  - Own agent (identified by `process.env.AGENT_ID`, default `'51049'`) is excluded from the sample.
  - Valid price range filter: `0.00001 ETH` to `1 ETH`.
  - Floor: `0.0005 ETH` (`PRICE_FLOOR`); ceiling: `0.02 ETH` (`PRICE_CEIL`).
  - Competitive price = `clamp(median * 0.90, PRICE_FLOOR, PRICE_CEIL)`.
  - Adjusted price is written back to `~/.workclaw/workclaw.json`.
- **Rate limits / constraints noted:** None explicitly handled; errors are caught and logged.
- **Broadcast behavior:** Market scan results are pushed to SSE clients via `broadcast({ type: 'market', ...marketData })`.

---

## 3. Railway (Deployment Platform)

- **Purpose:** Hosts and runs the application in production.
- **Integration type:** Platform-as-a-Service; not called at runtime, but governs deployment behavior.
- **Config file:** `railway.json`
- **Settings:**
  - Builder: `NIXPACKS` (auto-detects Node.js, runs `npm install` + `npm start`)
  - Restart policy: `ON_FAILURE`, max 3 retries
- **Environment variables injected by Railway:** `PORT` (Railway injects the public port).

---

## 4. Anthropic / Claude API

- **Purpose:** Powers the LLM brain of the `cashclaw-agent` subprocess, which actually performs the marketplace work tasks (writing, coding, research, etc.).
- **Auth method:** API key via environment variable `ANTHROPIC_API_KEY`.
- **Model configured:** `claude-sonnet-4-20250514`
- **Provider string:** `anthropic`
- **How it is set:** Written into `~/.workclaw/workclaw.json` under `llm.apiKey` at startup; consumed by the `cashclaw-agent` binary at runtime.
- **Direct API calls from `server.js`:** None — all Anthropic API calls are made internally by the `cashclaw-agent` subprocess.
- **Rate limits / constraints noted:** None explicitly handled in `server.js`; delegated to `cashclaw-agent`.

---

## 5. Base Blockchain (Ethereum L2)

- **Purpose:** Payment and settlement layer for marketplace work. The agent receives task payments in ETH on Base (or compatible EVM chain) to its configured wallet.
- **Auth / credentials:** Wallet address and private key injected via environment variables `WALLET_ADDRESS` and `WALLET_PRIVATE_KEY`; written to `~/.moltlaunch/wallet.json` at startup.
- **Direct blockchain RPC calls from `server.js`:** None — on-chain interactions are handled internally by the `cashclaw-agent` and/or `moltlaunch` npm package.
- **Pricing unit:** All prices are denominated in ETH (wei internally, converted via `/ 1e18`).
- **Configured price range:** `baseRateEth: '0.005'` (dynamically adjusted), `maxRateEth: '0.05'`.

---

## Environment Variables Summary

| Variable | Used By | Description |
|---|---|---|
| `PORT` | `server.js` | HTTP server port (default `3777`; Railway injects this) |
| `AGENT_ID` | `server.js`, `cashclaw-agent` | Moltlaunch marketplace agent ID (default `'51049'`) |
| `ANTHROPIC_API_KEY` | `cashclaw-agent` (via workclaw.json) | Anthropic API key for Claude |
| `WALLET_ADDRESS` | `cashclaw-agent` (via wallet.json) | EVM wallet address for receiving ETH payments |
| `WALLET_PRIVATE_KEY` | `cashclaw-agent` (via wallet.json) | EVM wallet private key for signing transactions |
