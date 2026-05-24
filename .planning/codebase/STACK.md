# STACK.md

## Runtime & Language

- **Runtime:** Node.js (>=20, as specified in `package.json` `engines` field)
- **Language:** JavaScript (CommonJS modules, no transpilation)
- **Entry point:** `server.js`

## Frameworks & Libraries

No web framework is used. The HTTP server is built directly with Node.js built-in modules:

- `http` — serves the dashboard and REST API endpoints
- `https` — makes outbound HTTP requests (CoinGecko, Moltlaunch)
- `fs`, `os`, `path` — filesystem and config file management
- `child_process` (spawn) — launches the `cashclaw-agent` subprocess

## Key npm Packages

| Package | Version (package.json) | Role |
|---|---|---|
| `cashclaw-agent` | `^0.1.0` | Core autonomous work agent; spawned as a child process; its binary is at `node_modules/.bin/cashclaw` and its compiled output at `node_modules/cashclaw-agent/dist/index.js` |
| `moltlaunch` | `latest` | Moltlaunch marketplace SDK/utilities (used for agent config and wallet setup via `.moltlaunch/wallet.json`) |

## Project Identity

- **Package name:** `jabenoitv-cashclaw`
- **Version:** `1.0.2`
- **Description:** CashClaw autonomous work agent for jabenoitv
- **Private:** true (not published to npm)

## Build System

- **No build step.** The project runs directly with `node server.js`.
- **Start script:** `npm start` → `node server.js`
- **Procfile start command:** `node -e "..."` (an inlined bootstrap script that sets up config files then spawns `cashclaw`)
- **Build tool (deployment):** Nixpacks (configured in `railway.json`)

## Deployment Platform

- **Platform:** [Railway](https://railway.app)
- **Config file:** `railway.json`
- **Builder:** NIXPACKS
- **Restart policy:** `ON_FAILURE`, max 3 retries
- The application also implements its own restart loop for the `cashclaw` subprocess (15-second delay, unlimited retries tracked via `restartCount`)

## Server Architecture

- Single-file HTTP server (`server.js`) that:
  - Listens on `PORT` (env var, default `3777`)
  - Runs the `cashclaw-agent` subprocess on `PORT + 1`
  - Serves a self-contained HTML/JS dashboard at `/`
  - Exposes REST endpoints: `/api/status`, `/api/price`, `/api/market`, `/api/logs`, `/api/jobs`
  - Implements Server-Sent Events (SSE) at `/events` with a 25-second keepalive ping
- Config files written at startup to `~/.workclaw/workclaw.json` and `~/.moltlaunch/wallet.json`
