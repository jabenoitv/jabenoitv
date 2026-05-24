# State — CashClaw Dashboard

## Current Status
- **Active Milestone**: Milestone 3 — Market Intelligence (COMPLETE)
- **Active Phase**: None (between milestones)
- **Overall Project Health**: Green

---

## Last Completed Work

### Milestone 3: Market Intelligence — COMPLETE (2026-05-24)

All three phases delivered:

**Phase 3.1 — Market Scanner**
- Moltlaunch API polled every 30 min via `setInterval`
- Median price computed from live agent listings
- Scan results logged to server stdout

**Phase 3.2 — Dynamic Pricing**
- Price set to 10% below median on each scan cycle
- Floor (0.0005 ETH) and ceiling (0.02 ETH) enforced
- Price-change events pushed to SSE clients in real time

**Phase 3.3 — Price Indicator Cards**
- "Precio cobrado" card: ETH / USD / CLP
- "Nuestro precio" card in market section: ETH / USD / CLP
- Both cards respond live to SSE price-change events

---

## What's Next

### Milestone 4: Persistence & Reliability (PLANNED)

Priority phases in order:

1. **Phase 4.1 — SQLite Integration**: Add `better-sqlite3`, create `jobs` and `earnings` tables, migrate in-memory state to durable storage. This is the highest-priority gap — earnings and job history are lost on every Railway redeploy.

2. **Phase 4.2 — State Recovery**: Serve full state snapshot to new SSE clients on connect; reconcile localStorage with server truth on page load.

3. **Phase 4.3 — Dashboard Authentication**: HTTP Basic Auth or Bearer token gate via Railway env var. Currently the dashboard is open to anyone with the Railway URL.

---

## Known Blockers

| Blocker | Impact | Resolution path |
|---------|--------|-----------------|
| No persistent storage (Railway ephemeral filesystem) | Earnings and job history lost on every redeploy | Milestone 4 — SQLite via `better-sqlite3` |
| Dashboard has no authentication | Anyone with the URL can view earnings and agent status | Phase 4.3 — HTTP Basic Auth via Railway env var |
| Moltlaunch API availability not guaranteed | Market scanner silently fails if API is down | Add retry logic + last-known-price fallback in Phase 4.2 |
| USD/CLP rate may be hardcoded or stale | CLP display drifts from real exchange rate | Future: fetch live USD/CLP from a FX API alongside CoinGecko |

---

## Environment

| Variable | Purpose |
|----------|---------|
| Railway auto-deploy | Triggered on push to `main` branch |
| Agent ID | 51049 on Moltlaunch, Base chain (8453) |
| ETH price source | CoinGecko public API, 5-min interval |
| Market scan source | `https://api.moltlaunch.com/api/agents`, 30-min interval |

---

## Session Notes
- Project initialized into GSD planning on 2026-05-24
- Milestones 1–3 retroactively documented based on implemented features
- Milestone 4 is the recommended next focus area
