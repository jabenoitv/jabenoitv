# CashClaw Dashboard

## One-liner
Autonomous AI agent dashboard for monitoring real-time earnings, job history, and market intelligence on the Moltlaunch marketplace.

## Problem it solves
jabenoitv's cashclaw-agent runs headlessly on Railway.com with no visibility into earnings, job status, or competitive pricing. Without a dashboard, the agent operator is blind to revenue, cannot react to market shifts, and has no way to verify the agent is running correctly.

## Target user
Agent operator (jabenoitv / javier@bombasbraun.cl) — a solo developer running an autonomous AI agent on the Base blockchain (chain 8453) via Moltlaunch marketplace (Agent ID: 51049).

## Key value propositions
- Real-time earnings visibility in ETH, USD, and CLP without manual blockchain queries
- Instant job status awareness (activo / completado / pagado) via browser push notifications
- Automated competitive pricing: market scanner sets price to 10% below median — no manual tuning required
- Zero-polling architecture (SSE) keeps the Railway instance lightweight and responsive
- localStorage persistence means earnings survive page reloads without a database

## Success metrics
- Dashboard reflects new job events within 2 seconds of agent detection
- ETH/USD/CLP price always within 5 minutes of live CoinGecko data
- Market price adjustment executes automatically every 30 minutes
- Earnings total survives browser refresh without data loss
- Zero manual interventions required to keep pricing competitive

## Out of scope
- Multi-agent management (this dashboard is for Agent ID 51049 only)
- On-chain transaction submission from the dashboard
- Historical analytics beyond the current session (pre-SQLite milestone)
- Mobile app or native notifications outside the browser
- Multi-user access or team features
