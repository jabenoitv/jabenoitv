#!/bin/sh
set -e

mkdir -p /root/.workclaw /root/.moltlaunch

node -e "
const fs = require('fs');

const config = {
  polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
  pricing: { strategy: 'fixed', baseRateEth: '0.005', maxRateEth: '0.05' },
  specialties: [],
  autoQuote: true,
  autoWork: true,
  maxConcurrentTasks: 3,
  declineKeywords: [],
  agentId: process.env.AGENT_ID || '',
  llm: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: 'claude-sonnet-4-20250514'
  }
};

const wallet = {
  address: process.env.WALLET_ADDRESS || '',
  privateKey: process.env.WALLET_PRIVATE_KEY || '',
  createdAt: new Date().toISOString()
};

fs.writeFileSync('/root/.workclaw/workclaw.json', JSON.stringify(config, null, 2));
fs.writeFileSync('/root/.moltlaunch/wallet.json', JSON.stringify(wallet, null, 2));
console.log('Config ready. AgentId:', process.env.AGENT_ID);
"

exec cashclaw
