const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

const worklawDir = path.join(os.homedir(), '.workclaw');
const moltDir = path.join(os.homedir(), '.moltlaunch');

fs.mkdirSync(worklawDir, { recursive: true });
fs.mkdirSync(moltDir, { recursive: true });

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

fs.writeFileSync(path.join(worklawDir, 'workclaw.json'), JSON.stringify(config, null, 2));
fs.writeFileSync(path.join(moltDir, 'wallet.json'), JSON.stringify(wallet, null, 2));
console.log('Config ready. AgentId:', process.env.AGENT_ID);

// Find cashclaw binary
const candidates = [
  path.join(__dirname, 'node_modules', '.bin', 'cashclaw'),
  '/usr/local/bin/cashclaw',
  'cashclaw'
];
let bin = 'cashclaw';
for (const c of candidates) {
  try { if (fs.existsSync(c)) { bin = c; break; } } catch(_) {}
}

const child = spawn(bin, [], { stdio: 'inherit', env: process.env });
child.on('exit', code => process.exit(code || 0));
