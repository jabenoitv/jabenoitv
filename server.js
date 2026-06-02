const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { startBountyEngine, getClaudeCallCount } = require('./farcaster-bounties.js');

process.on('uncaughtException', (err) => {
  console.error('[CRASH EVITADO] uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH EVITADO] unhandledRejection:', reason && reason.message ? reason.message : String(reason));
});

const w = path.join(os.homedir(), '.workclaw');
const m = path.join(os.homedir(), '.moltlaunch');
fs.mkdirSync(w, { recursive: true });
fs.mkdirSync(path.join(w, 'logs'), { recursive: true });
fs.mkdirSync(m, { recursive: true });

fs.writeFileSync(path.join(w, 'workclaw.json'), JSON.stringify({
  polling: { intervalMs: 1800000, urgentIntervalMs: 600000 },
  pricing: { strategy: 'fixed', baseRateEth: '0.005', maxRateEth: '0.05' },
  specialties: [
    'writing','copywriting','content-creation','blog-writing',
    'email-writing','social-media-content','product-descriptions',
    'technical-writing','creative-writing','proofreading','editing',
    'research','web-research','market-research','competitive-analysis',
    'data-analysis','summarization','fact-checking',
    'coding','programming','debugging','code-review',
    'documentation','api-documentation',
    'business-writing','report-writing','seo-content','customer-support-templates',
    'translation','language-editing',
    'web-scraping','data-extraction','website-analysis',
    'question-answering','brainstorming','planning','consulting'
  ],
  autoQuote: true, autoWork: true, maxConcurrentTasks: 3,
  declineKeywords: ['image-generation','video-creation','audio-generation','music-creation','nsfw','illegal'],
  agentId: process.env.AGENT_ID || '',
  llm: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY || '', model: 'claude-sonnet-4-6' }
}, null, 2));

fs.writeFileSync(path.join(m, 'wallet.json'), JSON.stringify({
  address: process.env.WALLET_ADDRESS || '',
  privateKey: process.env.WALLET_PRIVATE_KEY || ''
}, null, 2));

const PORT = Number(process.env.PORT || 3777);
const CASHCLAW_PORT = PORT + 1;
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || '';
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY || '';
const NEYNAR_CLIENT_ID = 'd217f14b-b3dd-41fd-aa9b-107c7832d46b';
const PUBLIC_URL = 'https://jabenoitv-production.up.railway.app';
let farcasterSignerUuid = process.env.FARCASTER_SIGNER_UUID || '';

console.log('Config ready. AgentId:', process.env.AGENT_ID);
console.log('Wallet address:', process.env.WALLET_ADDRESS || '(no configurada)');
console.log('Private key:', process.env.WALLET_PRIVATE_KEY ? '***configurada***' : '(FALTA WALLET_PRIVATE_KEY)');
console.log('Farcaster:', NEYNAR_API_KEY ? 'API key OK' : '(FALTA NEYNAR_API_KEY)', '/', farcasterSignerUuid ? 'signer OK' : 'pendiente SIWN — visita /connect-farcaster');
console.log('[DIAG] HOME:', os.homedir(), '| UID:', process.getuid ? process.getuid() : 'n/a', '| workclaw dir:', w);
if (!DASHBOARD_SECRET) {
  console.warn('===========================================================');
  console.warn('[SEGURIDAD] DASHBOARD_SECRET NO esta configurado: TODOS los endpoints estan PUBLICOS (fail-open). Configura DASHBOARD_SECRET para proteger el dashboard.');
  console.warn('===========================================================');
}

const cashclawDist = path.join(process.cwd(), 'node_modules', 'cashclaw-agent', 'dist', 'index.js');
let cashclawPatchOk = false;
try {
  let src = fs.readFileSync(cashclawDist, 'utf8');
  if (src.includes('var PORT = 3777')) {
    src = src.replace('var PORT = 3777;', 'var PORT = ' + CASHCLAW_PORT + ';');
    src = src.replace(/localhost:3777/g, 'localhost:' + CASHCLAW_PORT);
    fs.writeFileSync(cashclawDist, src);
    const verify = fs.readFileSync(cashclawDist, 'utf8');
    if (verify.includes('var PORT = 3777')) {
      console.error('ERROR: Patch de puerto fallido - cashclaw aun usa 3777, abortando');
      process.exit(1);
    }
    console.log('Cashclaw parcheado y verificado: puerto ' + CASHCLAW_PORT);
    cashclawPatchOk = true;
  } else {
    if (src.includes('var PORT = ' + CASHCLAW_PORT) || src.includes('localhost:' + CASHCLAW_PORT)) {
      console.log('Cashclaw ya usa puerto correcto (' + CASHCLAW_PORT + ')');
      cashclawPatchOk = true;
    } else {
      console.warn('[WARNING] Patron de puerto de cashclaw no encontrado (ni "var PORT = 3777" ni puerto correcto ' + CASHCLAW_PORT + '). El dist puede tener otra estructura; revisar manualmente.');
    }
  }
} catch (e) { console.log('No se pudo parchear cashclaw:', e.message); }

// SSE clients
const sseClients = [];
function broadcast(obj) {
  const msg = 'data: ' + JSON.stringify(obj) + '\n\n';
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(msg); } catch (e) { sseClients.splice(i, 1); }
  }
}
setInterval(() => {
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(':keepalive\n\n'); } catch (e) { sseClients.splice(i, 1); }
  }
}, 25000);

// ETH price — load from state cache, retry with backoff on failure
let ethPrice = { usd: 0, clp: 0, updatedAt: null };
let ethFetchRetry = 0;
function fetchEthPrice() {
  const req = https.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,clp',
    { headers: { 'User-Agent': 'cashclaw-dashboard/1.0' } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (d.ethereum) {
            ethPrice = { usd: d.ethereum.usd, clp: d.ethereum.clp, updatedAt: new Date().toISOString() };
            ethFetchRetry = 0;
            console.log('Precio ETH: $' + ethPrice.usd + ' USD');
            broadcast({ type: 'price', usd: ethPrice.usd, clp: ethPrice.clp, updatedAt: ethPrice.updatedAt });
            saveState();
          }
        } catch (e) {
          ethFetchRetry++;
          console.log('Error precio ETH (intento ' + ethFetchRetry + '):', e.message);
          setTimeout(fetchEthPrice, Math.min(ethFetchRetry * 30000, 300000));
        }
      });
    }).on('error', e => {
      ethFetchRetry++;
      console.log('No se pudo obtener precio ETH (intento ' + ethFetchRetry + '):', e.message);
      setTimeout(fetchEthPrice, Math.min(ethFetchRetry * 30000, 300000));
    });
  req.setTimeout(15000, () => req.destroy(new Error('timeout')));
}
fetchEthPrice();
setInterval(fetchEthPrice, 5 * 60 * 1000);

// Inteligencia de mercado
const PRICE_FLOOR = 0.0001;
const PRICE_CEIL  = 0.02;
let marketData = { agents: 0, median: 0, ourPrice: 0.005, min: 0, max: 0, lastScan: null };

function fetchMarketPrices() {
  const req = https.get('https://api.moltlaunch.com/api/agents', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://moltlaunch.com/'
    }
  }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.log('API mercado HTTP ' + res.statusCode + ' (posible bloqueo Cloudflare)');
          return;
        }
        try {
          const data = JSON.parse(body);
          const agents = Array.isArray(data) ? data : (data.agents || []);
          const myId = String(process.env.AGENT_ID || '51049');

          const prices = agents
            .filter(a => String(a.agentId) !== myId && a.priceWei)
            .map(a => { try { return Number(a.priceWei) / 1e18; } catch(e) { return 0; } })
            .filter(p => p >= 0.00001 && p <= 1);

          if (prices.length === 0) {
            console.log('Mercado: sin datos de precios en la respuesta');
            return;
          }

          prices.sort((a, b) => a - b);
          const median = prices[Math.floor(prices.length / 2)];
          const competitive = Math.max(PRICE_FLOOR, Math.min(PRICE_CEIL, median * 0.90));
          const competitiveStr = competitive.toFixed(6);

          const wcPath = path.join(os.homedir(), '.workclaw', 'workclaw.json');
          try {
            const cfg = JSON.parse(fs.readFileSync(wcPath, 'utf8'));
            const old = cfg.pricing.baseRateEth;
            cfg.pricing.baseRateEth = competitiveStr;
            fs.writeFileSync(wcPath, JSON.stringify(cfg, null, 2));
            if (old !== competitiveStr)
              console.log('Precio ajustado: ' + old + ' -> ' + competitiveStr + ' ETH (mediana: ' + median.toFixed(6) + ', ' + prices.length + ' agentes)');
          } catch(e) { console.log('Error actualizando precio:', e.message); }

          marketData = {
            agents: prices.length,
            median: median,
            ourPrice: competitive,
            min: prices[0],
            max: prices[prices.length - 1],
            lastScan: new Date().toISOString()
          };
          broadcast({ type: 'market', ...marketData });
          console.log('Mercado escaneado: ' + prices.length + ' agentes | mediana ' + median.toFixed(6) + ' ETH | nuestro precio ' + competitiveStr + ' ETH');
        } catch(e) { console.log('Error escaneando mercado:', e.message); }
      });
    }).on('error', e => { console.log('Error API mercado:', e.message); });
  req.setTimeout(15000, () => req.destroy(new Error('timeout')));
}
fetchMarketPrices();
setInterval(fetchMarketPrices, 30 * 60 * 1000);

// Estado del agente
const logs = [];
const MAX_LOGS = 500;
const logDedup = new Map(); // msg → { entry, timer } — 60-min window dedup
const LOG_DEDUP_WINDOW_MS = 60 * 60 * 1000;
const jobs = [];
const MAX_JOBS = 100;
let totalEarnedEth = 0;
let completedJobsCount = 0;
let lastActivity = null;
let cashclawProc = null;
let cashclawStatus = 'starting';
let restartCount = 0;
let shuttingDown = false;
const restartTimes = [];
let pollCount = 0;
let claimAttempts = 0;
let lastPollTime = null;
const claimedBounties = new Set();
let lastCashclawLogSize = 0;
let lastCashclawLogDate = '';
let lastSetupDate = '';
let lastFarcasterPost = 0;
let bountyState = { bountiesSeen: {}, bountiesSubmitted: [], lastBountySubmit: 0, bountiesPending: [], blacklistedFids: {} };
let lastScan = null;
let walletEth = null;
let walletUsdc = null;
let walletLastCheck = null;
let warnCount = 0;

// Estado persistente en disco
// DATA_DIR: set to a Railway Volume mount path (e.g. /data) to persist state across redeploys.
// Without a volume, state resets on each redeploy (Railway ephemeral filesystem).
const _preferredDataDir = process.env.DATA_DIR ? process.env.DATA_DIR : w;
try { fs.mkdirSync(_preferredDataDir, { recursive: true }); } catch (e) {}
// Verify the directory is actually writable (a Volume env var set without actual mount is a common mistake)
let _dataDirWritable = false;
let _dataDirWriteErr = '';
try {
  const _t = path.join(_preferredDataDir, '.write-test');
  fs.writeFileSync(_t, '');
  try { fs.unlinkSync(_t); } catch(e) {}
  _dataDirWritable = true;
} catch (e) { _dataDirWritable = false; _dataDirWriteErr = e.code + ': ' + e.message.slice(0, 80); }
const DATA_DIR = (_dataDirWritable || !process.env.DATA_DIR) ? _preferredDataDir : w;
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const stateFileExistedAtBoot = fs.existsSync(STATE_FILE);
const _usingVolume = !!process.env.DATA_DIR && _dataDirWritable;
let persistInfo = { usingVolume: _usingVolume, stateFileExistedAtBoot, restored: false, seenCount: 0, submittedCount: 0, fallback: process.env.DATA_DIR && !_dataDirWritable };

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (typeof s.totalEarnedEth === 'number' && s.totalEarnedEth > 0) totalEarnedEth = s.totalEarnedEth;
    if (typeof s.completedJobsCount === 'number') completedJobsCount = s.completedJobsCount;
    if (Array.isArray(s.jobs)) s.jobs.slice(0, MAX_JOBS).forEach(j => jobs.push(j));
    if (s.ethPrice && s.ethPrice.usd) ethPrice = s.ethPrice;
    if (typeof s.pollCount === 'number') pollCount = s.pollCount;
    if (typeof s.claimAttempts === 'number') claimAttempts = s.claimAttempts;
    if (s.marketplaceSetupDone) marketplaceSetupDone = true;
    if (s.lastSetupDate) lastSetupDate = s.lastSetupDate;
    if (typeof s.lastFarcasterPost === 'number') lastFarcasterPost = s.lastFarcasterPost;
    if (s.farcasterSignerUuid) farcasterSignerUuid = s.farcasterSignerUuid;
    if (Array.isArray(s.claimedBounties)) s.claimedBounties.forEach(id => claimedBounties.add(String(id)));
    if (s.bountiesSeen) bountyState.bountiesSeen = s.bountiesSeen;
    if (Array.isArray(s.bountiesSubmitted)) bountyState.bountiesSubmitted = s.bountiesSubmitted;
    if (s.lastBountySubmit) bountyState.lastBountySubmit = s.lastBountySubmit;
    if (Array.isArray(s.bountiesPending)) bountyState.bountiesPending = s.bountiesPending;
    if (s.blacklistedFids) bountyState.blacklistedFids = s.blacklistedFids;
    persistInfo.restored = true;
    persistInfo.seenCount = Object.keys(bountyState.bountiesSeen || {}).length;
    persistInfo.submittedCount = (bountyState.bountiesSubmitted || []).length;
    console.log('Estado restaurado: ' + totalEarnedEth.toFixed(6) + ' ETH, ' + completedJobsCount + ' trabajos, ' + pollCount + ' polls');
  } catch (e) { /* first run or corrupt state — no problem */ }
}

let marketplaceSetupDone = false;

function saveState() {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      totalEarnedEth, completedJobsCount, pollCount, claimAttempts,
      jobs: jobs.slice(0, MAX_JOBS), ethPrice, marketplaceSetupDone, lastSetupDate, lastFarcasterPost, farcasterSignerUuid,
      claimedBounties: [...claimedBounties].slice(-200),
      bountiesSeen: bountyState.bountiesSeen || {},
      bountiesSubmitted: bountyState.bountiesSubmitted || [],
      lastBountySubmit: bountyState.lastBountySubmit || 0,
      bountiesPending: bountyState.bountiesPending || [],
      blacklistedFids: bountyState.blacklistedFids || {},
      lastSync: new Date().toISOString()
    }));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) { addLog('⚠️ Error guardando estado: ' + e.message, 'warn'); }
}

loadState();
setInterval(saveState, 60000);
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido - guardando estado...');
  shuttingDown = true;
  saveState();
  if (cashclawProc) { try { cashclawProc.kill('SIGTERM'); } catch(e){} }
  process.exit(0);
});

function postToFarcaster(text) {
  if (!NEYNAR_API_KEY || !farcasterSignerUuid) return;
  if (Date.now() - lastFarcasterPost < 4 * 60 * 60 * 1000) {
    console.log('[FARCASTER] Cooldown activo, saltando');
    return;
  }
  lastFarcasterPost = Date.now();
  saveState();
  const body = JSON.stringify({ signer_uuid: farcasterSignerUuid, text: text.slice(0, 320) });
  const req = https.request({
    hostname: 'api.neynar.com', path: '/v2/farcaster/cast', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api_key': NEYNAR_API_KEY, 'Content-Length': Buffer.byteLength(body), 'Origin': 'https://jabenoitv-production.up.railway.app', 'Referer': 'https://jabenoitv-production.up.railway.app/' }
  }, res => {
    let d = ''; res.on('data', c => { d += c; });
    res.on('end', () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log('[FARCASTER] Post publicado: ' + text.slice(0, 80));
        addLog('Farcaster: post publicado', 'info');
      } else {
        console.log('[FARCASTER] Error ' + res.statusCode + ': ' + d.slice(0, 150));
        lastFarcasterPost = 0;
      }
    });
  });
  req.on('error', e => { console.log('[FARCASTER] Error de red:', e.message); lastFarcasterPost = 0; });
  req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  req.write(body); req.end();
}

function detectJobEvent(line, time) {
  if (/task.*receiv|receiv.*task|new.*task|job.*receiv|receiv.*job|assigned|accept.*offer|offer.*accept|new.*job/i.test(line)) {
    const dm = line.match(/["']([^"']{8,80})["']/) || line.match(/task[:\s]+(.{8,60})/i);
    jobs.unshift({ id: Date.now(), startTime: time, completedTime: null, status: 'activo',
      description: dm ? dm[1].trim() : line.trim().slice(0, 80), earnedEth: null });
    if (jobs.length > MAX_JOBS) jobs.pop();
  }
  if (/complet|finish|done.*task|task.*done|submit|deliver/i.test(line)) {
    const active = jobs.find(j => j.status === 'activo');
    if (active) { active.status = 'completado'; active.completedTime = time; completedJobsCount++; }
  }
  const em = line.match(/([0-9]+\.[0-9]+)\s*ETH/i);
  if (em && /earn|pay|receiv|reward|profit|transfer|sent/i.test(line)) {
    const eth = parseFloat(em[1]);
    if (eth > 0) {
      totalEarnedEth = Math.round((totalEarnedEth + eth) * 1e8) / 1e8;
      const j = jobs.find(j => j.status === 'completado' && !j.earnedEth);
      if (j) { j.earnedEth = eth; j.status = 'pagado'; }
      saveState();
      postToFarcaster('Job done, paid ' + eth.toFixed(6) + ' ETH on @moltlaunch. Taking new work 24/7. moltlaunch.com/agents/51049');
    }
  }
}

function addLog(line, type) {
  const msg = line.trim();
  const now = Date.now();
  // Map-based dedup: any identical message within 30 min gets collapsed (even non-consecutive)
  if (logDedup.has(msg)) {
    const d = logDedup.get(msg);
    d.entry.count = (d.entry.count || 1) + 1;
    d.entry.msg = msg + ' (x' + d.entry.count + ')';
    d.entry._baseMsg = msg;
    d.entry.time = new Date(now).toISOString();
    broadcast({ type: 'update', totalEarned: totalEarnedEth, jobCount: jobs.length });
    return;
  }
  if (type === 'warn') warnCount++;
  const entry = { time: new Date(now).toISOString(), msg, type };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  const t = setTimeout(() => logDedup.delete(msg), LOG_DEDUP_WINDOW_MS);
  if (t.unref) t.unref();
  logDedup.set(msg, { entry, timer: t });
  lastActivity = entry.time;
  if (/polled inbox|inbox.*task|polling inbox/i.test(line)) {
    pollCount++;
    lastPollTime = entry.time;
  }
  if (/bounty.*claim|claim.*bounty|reclamad|bounty.*accept/i.test(line)) {
    claimAttempts++;
  }
  const prevJobs = jobs.length;
  const prevEarned = totalEarnedEth;
  detectJobEvent(line, entry.time);
  broadcast({
    type: 'update', totalEarned: totalEarnedEth, jobCount: jobs.length,
    newJob: jobs.length > prevJobs ? jobs[0].description : null,
    newPayment: totalEarnedEth > prevEarned ? (totalEarnedEth - prevEarned).toFixed(6) : null
  });
}

// Perfil del agente en el marketplace
function setupAgentProfile() {
  const agentId = process.env.AGENT_ID || '51049';
  const args = [
    'profile', '--agent', agentId,
    '--tagline', 'Claude Sonnet agent. Writing, research, translation, strategy — delivered in under 2h, 24/7.',
    '--description', 'I am an autonomous AI agent powered by Claude Sonnet, running on dedicated infrastructure around the clock. No downtime, no time zones, no excuses.\n\nHere is what I deliver:\n\n• Tweet threads — hook in the first line, payoff in the last, voice that does not read as AI. Give me the topic, your audience, and one tweet you wish you had written. Done in 1 hour.\n\n• Landing page copy — headline, subheadline, value props, CTA. Send your URL or draft + who your customer is + what you want them to do. Back in 2 hours, markdown-ready, with 2 headline variants for A/B.\n\n• EN↔ES translation — marketing copy, docs, emails, app strings, subtitles. Up to 2000 words in 1 hour. Notes included on anything that does not transfer cleanly.\n\n• Research and competitive teardowns — 5 competitors, pricing, positioning, where they leak customers, 3 specific opportunities for you. 4 hours, no consulting-speak.\n\n• Content strategy — editorial calendars, content briefs, topic clusters, audience personas, brand voice guides.\n\n• Data summaries and reports — feed me a dataset, a document, or a URL and I return a structured summary, key findings, and recommended actions.\n\n• Copywriting for any format — emails, product descriptions, LinkedIn posts, pitch decks, bio rewrites, ad copy.\n\nI reply with the deliverable, not with clarifying questions. Brief me clearly and you get the work back fast. One free revision on every order. Pricing is intentionally low while I grow my track record — lock in these rates now.',
    '--response-time', '< 2 min',
    '--github', 'jabenoitv',
    '--json'
  ];
  execFile(mltlBin, args, { timeout: 30000 }, (err, stdout, stderr) => {
    const detail = (stderr || '').trim() || err && err.message || '';
    if (err) console.log('[PERFIL] Error:', detail.slice(0, 300));
    else console.log('[PERFIL] Perfil actualizado OK');
  });
}

const GIGS = [
  {
    title: 'Tweet thread that actually gets engagement',
    description: 'I write a tested 6-10 tweet thread on any topic you give me. Hook in the first line, payoff in the last. I research the angle, find the contrarian take, and write it in a voice that does not sound AI-generated. Send me: the topic, your audience, and one tweet from someone you wish you wrote like. I send back the thread in 1 hour. One free revision included.',
    price: '0.0001', delivery: '1h', category: 'writing'
  },
  {
    title: 'Landing page copy that converts',
    description: 'I rewrite your landing page so visitors stop bouncing. Headline, sub-headline, 3 value props, social proof framing, and CTA copy. Send me your URL or current draft + who your customer is + what you want them to do. You get the new copy in markdown, ready to paste, in 2 hours. Includes 2 alternative headlines so you can A/B test.',
    price: '0.0002', delivery: '2h', category: 'writing'
  },
  {
    title: 'Bug fix or feature: I open a PR in 4h',
    description: 'Share a public GitHub repo + describe the bug or feature. I diagnose, fix, write a test, and reply with a clean diff or PR link in 4 hours. Works for JS/TS/Python/Go/Rust. If the repo is private, paste the relevant files. I will not touch your secrets, no scope creep. Refund if I cannot reproduce the issue.',
    price: '0.0003', delivery: '4h', category: 'coding'
  },
  {
    title: 'Competitive teardown: 5 competitors in 4h',
    description: 'I pick 5 competitors in your niche (or take the list you provide), then for each: pricing, positioning, what they brag about, what they hide, where they leak customers. Output is a 1-page table + 3 specific opportunities for you. No fluff, no consulting-speak. Tell me your product + 1-line audience and I deliver in 4 hours.',
    price: '0.0003', delivery: '4h', category: 'research'
  },
  {
    title: 'Scrape a website and hand you clean CSV',
    description: 'Point me at a public website (no login walls). I extract the data you want, clean it, dedupe, and send a CSV plus a short note on what I skipped and why. Examples: product catalogs, directory listings, public reviews, news headlines. Works for up to 10k rows. Anything bigger send me a message first.',
    price: '0.0002', delivery: '2h', category: 'data-analysis'
  },
  {
    title: 'EN ↔ ES translation, sounding like a human',
    description: 'I translate between English and Spanish without the stiff machine-translation tone. Marketing copy, docs, emails, app strings, subtitles. Send me your text + the audience (US English, LATAM Spanish, Spain, formal/casual). You get the translation in 1 hour with notes on any phrase that does not transfer cleanly. Up to 2000 words.',
    price: '0.0001', delivery: '1h', category: 'writing'
  }
];

function setupGigs() {
  const agentId = process.env.AGENT_ID || '51049';
  execFile(mltlBin, ['gig', 'list', '--agent', agentId, '--json'], { timeout: 20000 }, (err, stdout) => {
    if (err) {
      console.log('[GIGS] Error listando gigs (KV limit?):', (err.message || '').slice(0, 150), '— saltando setup');
      return;
    }
    const existing = new Set();
    try {
      const d = JSON.parse(stdout);
      (Array.isArray(d) ? d : (d.gigs || [])).forEach(g => existing.add(g.title));
      console.log('[GIGS] Gigs existentes: ' + existing.size);
    } catch(e) {}
    const toCreate = GIGS.filter(g => !existing.has(g.title));
    if (toCreate.length === 0) {
      marketplaceSetupDone = true; saveState();
      console.log('[GIGS] Todos los gigs ya existen (' + existing.size + '/' + GIGS.length + ')');
      postToFarcaster('6 gigs live on @moltlaunch: tweet threads, landing copy, GitHub PRs, competitive teardowns, web scraping, EN↔ES translation. From 0.0001 ETH. moltlaunch.com/agents/51049');
      return;
    }
    // Create ONE gig per day to stay within the daily KV limit
    const gigToday = toCreate[0];
    console.log('[GIGS] Creando 1 gig hoy: "' + gigToday.title + '" (' + (existing.size + 1) + '/' + GIGS.length + ')');
    execFile(mltlBin, [
      'gig', 'create', '--agent', agentId,
      '--title', gigToday.title, '--description', gigToday.description,
      '--price', gigToday.price, '--delivery', gigToday.delivery,
      '--category', gigToday.category, '--json'
    ], { timeout: 30000 }, (e, o, se) => {
      const errMsg = ((se || '').trim() || (e && e.message) || '');
      if (e) {
        if (errMsg.includes('KV') && errMsg.includes('limit')) {
          console.log('[GIGS] KV limit alcanzado — reintentando mañana (medianoche UTC)');
        } else {
          console.log('[GIGS] Error "' + gigToday.title + '":', errMsg.slice(0, 200));
        }
      } else {
        const total = existing.size + 1;
        console.log('[GIGS] Creada: ' + gigToday.title + ' @ ' + gigToday.price + ' ETH (' + total + '/' + GIGS.length + ')');
        if (total >= GIGS.length) {
          marketplaceSetupDone = true; saveState();
          console.log('[GIGS] Setup completo: todos los gigs activos');
          console.log('[GIGS] *** Agrega GIGS_SETUP_DONE=1 en Railway para no repetir setup ***');
          postToFarcaster('6 gigs live on @moltlaunch: tweet threads, landing copy, GitHub PRs, competitive teardowns, web scraping, EN↔ES translation. From 0.0001 ETH. moltlaunch.com/agents/51049');
        } else {
          console.log('[GIGS] ' + (GIGS.length - total) + ' gigs pendientes — se crearán en días siguientes');
        }
      }
    });
  });
}

// Diagnostico de startup: verifica wallet y conectividad con Moltlaunch
function runStartupDiagnostics() {
  execFile(mltlBin, ['wallet', 'show', '--json'], { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      const detail = (stderr || '').trim() || (stdout || '').trim() || err.message;
      console.log('[DIAG] mltl wallet show FALLO:', detail.slice(0, 500));
    } else {
      try {
        const w = JSON.parse(stdout.trim());
        console.log('[DIAG] Wallet OK:', JSON.stringify(w).slice(0, 200));
      } catch(e) { console.log('[DIAG] Wallet output:', stdout.trim().slice(0, 300)); }
    }
  });
  const agentId = process.env.AGENT_ID || '51049';
  execFile(mltlBin, ['inbox', '--agent', agentId, '--json'], { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      const detail = (stderr || '').trim() || (stdout || '').trim() || err.message;
      console.log('[DIAG] mltl inbox FALLO:', detail.slice(0, 500));
    } else {
      console.log('[DIAG] mltl inbox OK:', stdout.trim().slice(0, 300));
    }
  });
}
setTimeout(runStartupDiagnostics, 3000);
function attemptMarketplaceSetup() {
  if (process.env.GIGS_SETUP_DONE === '1') {
    console.log('[SETUP] GIGS_SETUP_DONE=1 — setup permanentemente omitido');
    return;
  }
  if (marketplaceSetupDone) {
    console.log('[SETUP] Perfil y gigs ya configurados, saltando');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (lastSetupDate === today) {
    console.log('[SETUP] Ya intentado hoy (' + today + '), saltando hasta mañana');
    return;
  }
  lastSetupDate = today;
  saveState();
  console.log('[SETUP] Intentando configurar perfil y gigs...');
  setTimeout(setupAgentProfile, 5000);
  setTimeout(setupGigs, 9000);
}
attemptMarketplaceSetup();
setInterval(attemptMarketplaceSetup, 6 * 60 * 60 * 1000);

// Moltlaunch poll errors are external infrastructure noise — suppress from dashboard, still logged to Railway console.
const isMltlNoise = l => /poll error.*mltl|mltl.*poll error|command failed.*mltl inbox|mltl inbox.*command failed/i.test(l);

// Tail del log de cashclaw para ver actividad del heartbeat
function tailCashclawLog() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastCashclawLogDate) { lastCashclawLogDate = today; lastCashclawLogSize = 0; }
  const logFile = path.join(w, 'logs', today + '.md');
  try {
    const stat = fs.statSync(logFile);
    if (stat.size > lastCashclawLogSize) {
      const fd = fs.openSync(logFile, 'r');
      const buf = Buffer.alloc(stat.size - lastCashclawLogSize);
      fs.readSync(fd, buf, 0, buf.length, lastCashclawLogSize);
      fs.closeSync(fd);
      lastCashclawLogSize = stat.size;
      buf.toString('utf8').split('\n').forEach(line => {
        const match = line.match(/^-\s*`(\d{2}:\d{2}:\d{2})`\s+(.+)/);
        if (match && !isMltlNoise(match[2].trim())) addLog(match[2].trim(), 'info');
      });
    }
  } catch (e) { /* log file may not exist yet */ }
}
setInterval(tailCashclawLog, 5000);

// Localizar mltl: en Railway el PATH no incluye node_modules/.bin
const localBin = path.join(process.cwd(), 'node_modules', '.bin');
const mltlBinPath = path.join(localBin, 'mltl');
const mltlBin = fs.existsSync(mltlBinPath) ? mltlBinPath : 'mltl';

// Busqueda activa de bounties en el marketplace
function claimOpenBounties() {
  execFile(mltlBin, ['bounty', 'browse', '--json'], { timeout: 20000 }, (err, stdout, stderr) => {
    if (err) {
      const detail = (stderr || '').trim() || (stdout || '').trim() || err.message;
      console.log('Error browseando bounties:', detail.slice(0, 300));
      return;
    }
    try {
      const data = JSON.parse(stdout);
      const bounties = data.bounties || [];
      const fresh = bounties.filter(b => b.status === 'open' && !claimedBounties.has(String(b.id)));
      if (fresh.length === 0) { console.log('Sin bounties nuevas disponibles (' + bounties.length + ' total)'); return; }
      console.log('Bounties disponibles: ' + fresh.length + ' - intentando reclamar...');
      const agentId = process.env.AGENT_ID || '51049';
      fresh.slice(0, 5).forEach(b => {
        execFile(mltlBin, ['bounty', 'claim', '--task', String(b.id), '--agent', agentId, '--json'], { timeout: 20000 }, (e, o, se) => {
          if (e) {
            const ed = (se || '').trim() || (o || '').trim() || e.message;
            console.log('Error reclamando bounty ' + b.id + ':', ed.slice(0, 300));
          } else {
            claimedBounties.add(String(b.id));
            addLog('Bounty ' + b.id + ' reclamada: ' + (b.task || '').trim().slice(0, 60), 'info');
            saveState();
            postToFarcaster('Claimed a bounty on @moltlaunch. Available for new tasks 24/7. Check my gigs: moltlaunch.com/agents/51049');
          }
        });
      });
    } catch(e) { console.log('Error parseando bounties:', e.message); }
  });
}
claimOpenBounties();
setInterval(claimOpenBounties, 30 * 60 * 1000);

// Webhook push: registra URL para recibir notificaciones sin polling
function setupWebhook() {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || 'jabenoitv-production.up.railway.app';
  const publicUrl = (domain.startsWith('http') ? domain : 'https://' + domain).replace(/\/$/, '');
  if (!publicUrl) { console.log('[WEBHOOK] Configura PUBLIC_URL o RAILWAY_PUBLIC_DOMAIN para activar push'); return; }
  const agentId = process.env.AGENT_ID || '51049';
  const webhookUrl = publicUrl + '/webhook';
  execFile(mltlBin, ['webhook', 'set', '--agent', agentId, '--url', webhookUrl,
    '--events', 'task.requested,task.accepted,task.revised', '--json'],
    { timeout: 30000 }, (err, stdout, stderr) => {
      const detail = (stderr || '').trim() || err && err.message || '';
      if (err) console.log('[WEBHOOK] Error registrando:', detail.slice(0, 300));
      else console.log('[WEBHOOK] Push activo: ' + webhookUrl);
    });
}
setTimeout(setupWebhook, 15000);

const binPath = path.join(process.cwd(), 'node_modules', '.bin', 'cashclaw');
const bin = fs.existsSync(binPath) ? binPath : 'cashclaw';

function startCashclaw() {
  if (cashclawProc && !cashclawProc.killed) return;
  cashclawStatus = 'running';
  const augmentedEnv = Object.assign({}, process.env, {
    PATH: localBin + path.delimiter + (process.env.PATH || '')
  });
  cashclawProc = spawn(bin, [], { stdio: ['inherit', 'pipe', 'pipe'], env: augmentedEnv });
  cashclawProc.stdout.on('data', d =>
    d.toString().split('\n').filter(l => l.trim()).forEach(l => { process.stdout.write(l + '\n'); if (!isMltlNoise(l)) addLog(l, 'info'); })
  );
  cashclawProc.stderr.on('data', d =>
    d.toString().split('\n').filter(l => l.trim()).forEach(l => { process.stderr.write(l + '\n'); if (!isMltlNoise(l)) addLog(l, 'error'); })
  );
  cashclawProc.on('exit', code => {
    cashclawProc = null;
    if (shuttingDown) { cashclawStatus = 'stopped'; return; }
    restartCount++;
    const now = Date.now();
    restartTimes.push(now);
    const fiveMinAgo = now - 5 * 60 * 1000;
    while (restartTimes.length > 0 && restartTimes[0] < fiveMinAgo) restartTimes.shift();
    if (restartTimes.length > 5) {
      const msg = 'Restart loop detectado (' + restartTimes.length + ' reinicios en 5min) - pausando 5 minutos';
      console.log(msg); addLog(msg, 'warn');
      cashclawStatus = 'restarting';
      restartTimes.length = 0;
      setTimeout(startCashclaw, 5 * 60 * 1000);
    } else {
      const msg = 'CashClaw salio (codigo ' + code + ') reiniciando en 15s (#' + restartCount + ')';
      console.log(msg); addLog(msg, 'warn');
      cashclawStatus = 'restarting';
      setTimeout(startCashclaw, 15000);
    }
  });
}

const startTime = Date.now();
const AGENT_ID = process.env.AGENT_ID || '51049';

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0f172a">
<title>CashClaw - Agente ${AGENT_ID}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
header{background:#1e293b;padding:14px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
header h1{font-size:1.1em;color:#38bdf8}
.hdr-r{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.nbtn{background:transparent;border:1px solid #334155;color:#94a3b8;border-radius:20px;padding:4px 12px;font-size:.75em;cursor:pointer;transition:all .2s}
.nbtn:hover{border-color:#38bdf8;color:#38bdf8}
.nbtn.on{border-color:#4ade80;color:#4ade80}
.earn{background:linear-gradient(135deg,#052e16,#0a3d1f);border-bottom:2px solid #166534;padding:22px 24px;text-align:center}
@keyframes flash-earn{0%{box-shadow:0 0 0 0 rgba(74,222,128,.8)}60%{box-shadow:0 0 0 26px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
.earn.flash{animation:flash-earn .8s ease-out}
.earn-lbl{font-size:.7em;color:#86efac;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.earn-eth{font-size:2.4em;font-weight:800;color:#4ade80;font-family:monospace;letter-spacing:1px}
.earn-fiat{display:flex;justify-content:center;gap:20px;margin-top:8px;flex-wrap:wrap}
.earn-fiat span{font-size:1.1em;font-weight:600;color:#bbf7d0}
.sep{color:#166534}
.earn-ts{font-size:.7em;color:#4ade80;opacity:.55;margin-top:6px}
.prc-fiat{display:flex;flex-direction:column;gap:1px;margin-top:4px}
.prc-fiat span{font-size:.68em;color:#94a3b8;font-family:monospace}
.cards{display:flex;gap:12px;padding:14px 20px 0;flex-wrap:wrap}
.card{background:#1e293b;border-radius:10px;padding:13px 16px;flex:1;min-width:120px;border:1px solid #334155}
.card label{font-size:.66em;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
.card .v{font-size:1.2em;font-weight:700;margin-top:4px;color:#f1f5f9}
.card .v.mo{font-size:.78em;font-family:monospace;color:#94a3b8}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px;animation:pulse 2s infinite}
.dot.warn{background:#f59e0b}.dot.off{background:#ef4444}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.tags{padding:12px 20px;display:flex;flex-wrap:wrap;gap:6px}
.tag{background:#0f3460;color:#38bdf8;border:1px solid #1e4d8c;border-radius:20px;padding:2px 9px;font-size:.7em}
.sec{margin:12px 20px 0;background:#1e293b;border-radius:10px;border:1px solid #334155;overflow:hidden}
.sec-h{padding:10px 16px;border-bottom:1px solid #334155;font-size:.78em;color:#94a3b8;display:flex;justify-content:space-between;align-items:center}
.mkt-body{padding:12px 16px 14px;display:flex;gap:10px;flex-wrap:wrap}
.mc{background:#0f172a;border-radius:8px;padding:10px 14px;flex:1;min-width:130px;border:1px solid #1e293b}
.mc .ml{font-size:.64em;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
.mc .mv{font-size:1em;font-weight:700;margin-top:4px;font-family:monospace;color:#f1f5f9}
.mc .ms{font-size:.7em;color:#475569;margin-top:2px}
.log{padding:5px 16px;border-bottom:1px solid #162032;font-family:monospace;font-size:.76em;display:flex;gap:10px;line-height:1.4}
.log:last-child{border-bottom:none}
.log .t{color:#475569;white-space:nowrap;flex-shrink:0}
.log .msg{color:#cbd5e1;word-break:break-all}
.log.error .msg{color:#fca5a5}.log.warn .msg{color:#fbbf24}
.jr{padding:10px 16px;border-bottom:1px solid #162032;display:flex;gap:10px;align-items:flex-start;font-size:.78em}
.jr:last-child{border-bottom:none}
.bdg{padding:2px 8px;border-radius:10px;font-size:.68em;font-weight:700;white-space:nowrap;flex-shrink:0;margin-top:1px}
.bdg.activo{background:#422006;color:#fbbf24;border:1px solid #92400e}
.bdg.completado{background:#0c1a2e;color:#60a5fa;border:1px solid #1d4ed8}
.bdg.pagado{background:#052e16;color:#4ade80;border:1px solid #166534}
.jb{flex:1;min-width:0}.jd{color:#cbd5e1;word-break:break-word}
.jm{font-size:.7em;color:#475569;margin-top:2px}
.je{color:#4ade80;font-weight:700;white-space:nowrap;font-family:monospace;flex-shrink:0;font-size:.8em;margin-top:1px}
.cpybtn{background:transparent;border:1px solid #334155;color:#64748b;border-radius:6px;padding:2px 8px;font-size:.68em;cursor:pointer;transition:all .2s}
.cpybtn:hover{border-color:#38bdf8;color:#38bdf8}
.cpybtn.ok{border-color:#4ade80;color:#4ade80}
.ldot.on{background:#22c55e;animation:pulse 1.5s infinite}
.empty{padding:28px;text-align:center;color:#475569;font-size:.86em}
.footer{text-align:center;padding:12px;color:#475569;font-size:.72em;margin-top:12px}
.footer a{color:#38bdf8;text-decoration:none}
.bsec{margin:12px 20px 0;background:#1e1b2e;border-radius:10px;border:1px solid #3b1f6e;overflow:hidden}
.bsec .sec-h{padding:10px 16px;border-bottom:1px solid #3b1f6e;font-size:.78em;color:#a78bfa;display:flex;justify-content:space-between;align-items:center}
.bcards{display:flex;gap:10px;padding:12px 16px;flex-wrap:wrap}
.bc{background:#0f0c1a;border-radius:8px;padding:10px 14px;flex:1;min-width:110px;border:1px solid #2d1b5e}
.bc .bl{font-size:.63em;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px}
.bc .bv{font-size:1.05em;font-weight:700;margin-top:4px;font-family:monospace;color:#e9d5ff}
.bc .bs{font-size:.68em;color:#64748b;margin-top:2px}
.bitem{padding:10px 16px;border-bottom:1px solid #1e1040;display:flex;gap:8px;align-items:flex-start;font-size:.76em}
.bitem:last-child{border-bottom:none}
.btag{padding:2px 7px;border-radius:8px;font-size:.66em;font-weight:700;white-space:nowrap;flex-shrink:0}
.btag.dry{background:#1e1040;color:#a78bfa;border:1px solid #4c1d95}
.btag.sent{background:#052e16;color:#4ade80;border:1px solid #166534}
.bmsg{flex:1;min-width:0;color:#c4b5fd;word-break:break-word}
.bamt{color:#a78bfa;font-weight:700;white-space:nowrap;font-family:monospace;font-size:.85em;margin-top:1px;flex-shrink:0}
.mode-badge{padding:2px 9px;border-radius:10px;font-size:.68em;font-weight:700}
.mode-dry{background:#1e1040;color:#a78bfa;border:1px solid #4c1d95}
.mode-live{background:#052e16;color:#4ade80;border:1px solid #166534}
</style>
</head>
<body>
<header>
  <div>
    <h1>CashClaw</h1>
    <p style="color:#94a3b8;font-size:.73em;margin-top:2px">ID #${AGENT_ID} - Moltlaunch Marketplace</p>
  </div>
  <div class="hdr-r">
    <span id="clock" style="font-size:.78em;color:#94a3b8;font-variant-numeric:tabular-nums;margin-right:10px"></span>
    <span id="errbadge" style="display:none;background:#dc2626;color:#fff;border-radius:10px;padding:1px 8px;font-size:.72em;cursor:pointer;margin-right:6px" onclick="showErrors()">0 err</span>
    <span id="hst" style="font-size:.75em;color:#94a3b8">conectando...</span>
    <button class="nbtn" id="rfrbtn" onclick="location.reload()" style="font-size:.9em;padding:7px 18px">⟳ Refrescar</button>
    <button class="nbtn" id="snpbtn" onclick="copySnapshot()">Copiar todo</button>
    <button class="nbtn" id="nb">Alertas</button>
  </div>
</header>
<div class="earn" id="earn">
  <div class="earn-lbl">Wallet Base (en vivo)</div>
  <div class="earn-eth" id="earn-eth">cargando...</div>
  <div class="earn-fiat">
    <span id="earn-usdc">USDC: —</span>
    <span class="sep"> | </span>
    <span id="earn-usd">$ — USD</span>
    <span class="sep"> | </span>
    <span id="earn-clp">$ — CLP</span>
  </div>
  <div class="earn-ts" id="earn-ts">sin datos aún · actualiza cada 5 min</div>
</div>
<div class="cards">
  <div class="card"><label>Estado</label><div class="v" id="st"><span class="dot warn"></span>...</div></div>
  <div class="card"><label>Activo</label><div class="v" id="up">-</div></div>
  <div class="card"><label>Trabajos</label><div class="v" id="jbadge">0</div></div>
  <div class="card"><label>Wallet</label><div class="v mo" id="wal">-</div></div>
  <div class="card"><label>Precio cobrado</label><div class="v mo" id="prc-eth">-</div><div class="prc-fiat"><span id="prc-usd"></span><span id="prc-clp"></span></div></div>
  <div class="card"><label>Polls inbox</label><div class="v" id="poll-cnt">0</div></div>
  <div class="card"><label>Bounties int.</label><div class="v" id="claim-cnt">0</div></div>
</div>
<div class="tags">
  <span class="tag">writing</span><span class="tag">copywriting</span><span class="tag">research</span>
  <span class="tag">coding</span><span class="tag">data-analysis</span><span class="tag">translation</span>
  <span class="tag">brainstorming</span><span class="tag">consulting</span><span class="tag">+28 mas</span>
</div>
<div class="sec">
  <div class="sec-h">
    <span>Inteligencia de Mercado</span>
    <span id="mkt-ts" style="color:#64748b">escaneando...</span>
  </div>
  <div class="mkt-body">
    <div class="mc">
      <div class="ml">Mediana mercado</div>
      <div class="mv" id="mkt-med">-</div>
      <div class="ms" id="mkt-med-usd"></div>
    </div>
    <div class="mc">
      <div class="ml">Nuestro precio</div>
      <div class="mv" style="color:#4ade80" id="mkt-our">-</div>
      <div class="ms" id="mkt-our-usd"></div>
      <div class="ms" id="mkt-our-clp"></div>
    </div>
    <div class="mc">
      <div class="ml">Posicion</div>
      <div class="mv" id="mkt-pct">-</div>
      <div class="ms" id="mkt-nagents"></div>
    </div>
    <div class="mc">
      <div class="ml">Rango mercado</div>
      <div class="mv" style="font-size:.85em" id="mkt-range">-</div>
      <div class="ms" id="mkt-next">escaneo: 30 min</div>
    </div>
  </div>
</div>
<div class="sec">
  <div class="sec-h"><span>Registro de Trabajos</span><span id="jcnt" style="color:#64748b">-</span></div>
  <div id="jlist"><div class="empty">Esperando primer trabajo del marketplace...</div></div>
</div>
<div class="sec">
  <div class="sec-h"><span><span class="ldot" id="ldot"></span>Actividad reciente</span><span id="lcnt" style="color:#64748b;font-size:.75em">-</span></div>
  <div id="llist"><div class="empty">Cargando...</div></div>
</div>
<div class="sec">
  <div class="sec-h"><span>Costos y ROI</span><span id="roi-ts" style="color:#64748b;font-size:.75em">—</span></div>
  <div class="bcards">
    <div class="bc"><div class="bl">Llamadas Claude</div><div class="bv" id="roi-calls">0</div><div class="bs" id="roi-cost">~$0.00</div></div>
    <div class="bc"><div class="bl">Pendiente cobro</div><div class="bv" id="roi-pend">$0</div><div class="bs">USDC enviados sin pagar</div></div>
    <div class="bc"><div class="bl">Railway est.</div><div class="bv">~$5</div><div class="bs">/mes (Hobby)</div></div>
    <div class="bc"><div class="bl">Veredicto</div><div class="bv" id="roi-net" style="font-size:.85em">—</div><div class="bs" id="roi-verdict"></div></div>
  </div>
</div>
<div class="bsec">
  <div class="sec-h">
    <span>Bounties Farcaster <span id="bmode" class="mode-badge mode-dry">dry-run</span></span>
    <span id="bts" style="color:#7c3aed">escaneando...</span>
  </div>
  <div class="bcards">
    <div class="bc"><div class="bl">Trabajos enviados</div><div class="bv" id="b-total">0</div><div class="bs">pendiente de pago</div></div>
    <div class="bc"><div class="bl">Esperando pago</div><div class="bv" id="b-pending">0</div><div class="bs" id="b-blacklist">0 bloqueados</div></div>
    <div class="bc"><div class="bl">Enviados hoy</div><div class="bv" id="b-today">0</div><div class="bs" id="b-limit">máx 5/día</div></div>
    <div class="bc"><div class="bl">Último trabajo</div><div class="bv" id="b-lasttok">—</div><div class="bs" id="b-lastscore"></div></div>
  </div>
  <div id="bstatus" style="padding:8px 12px;font-size:.82em;color:#64748b;border-top:1px solid #1e293b">Esperando primer ciclo...</div>
  <div id="blist"></div>
  <div id="bmore" style="display:none;text-align:center;padding:8px"><button class="nbtn" style="font-size:.8em" onclick="loadMoreBounties()">Ver todo el historial</button></div>
</div>
<div class="footer"><a href="/">Refrescar</a> · build v15</div>
<script>
var ethUsd=0,ethClp=0,prevEarned=0,prevJC=0,notifOk=false,loadTmr=null,ourPrice=0;
var _tk=new URLSearchParams(window.location.search).get('token')||'';
function _tq(u){return _tk?u+(u.indexOf('?')>=0?'&':'?')+'token='+_tk:u;}
function afetch(u){return fetch(_tq(u)).then(function(x){return x.json();});}

function fmt(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60),sc=s%60;return h?h+'h '+m+'m':m?m+'m '+sc+'s':sc+'s';}
function ftime(iso){return new Date(iso).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function fdate(iso){var d=new Date(iso);return d.toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'})+' '+ftime(iso);}
function fdur(a,b){if(!b)return 'activo';var m=Math.round((new Date(b)-new Date(a))/60000);return m<1?'<1min':m+'min';}
function fN(n,d){return n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function fEth(v){return v.toFixed(6)+' ETH';}
function fUsd(v){return '$ '+fN(v,2)+' USD';}
function fClp(v){return '$ '+Math.round(v).toLocaleString('es-CL')+' CLP';}
var dC={running:'dot',restarting:'dot warn',starting:'dot warn',stopped:'dot off'};

setInterval(function(){var d=new Date();document.getElementById('clock').textContent=d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});},1000);

function loadWallet(){
  afetch('/api/wallet').then(function(w){
    var eth=w.eth,usdc=w.usdc;
    if(eth!==null&&eth!==undefined){
      document.getElementById('earn-eth').textContent=eth.toFixed(6)+' ETH';
      var usd=eth*(ethUsd||0);
      if(ethUsd){document.getElementById('earn-usd').textContent='$ '+fN(usd,2)+' USD';document.getElementById('earn-clp').textContent='$ '+Math.round(usd*(ethClp||0)).toLocaleString('es-CL')+' CLP';}
    }
    if(usdc!==null&&usdc!==undefined)document.getElementById('earn-usdc').textContent='USDC: '+fN(usdc,2);
    if(w.lastCheck)document.getElementById('earn-ts').textContent='Actualizado: '+ftime(new Date(w.lastCheck).toISOString())+' · prox. 5 min';
    var calls=w.claudeCalls||0,cost=calls*0.003;
    document.getElementById('roi-calls').textContent=calls;
    document.getElementById('roi-cost').textContent='~$'+fN(cost,2)+' USD';
    document.getElementById('roi-ts').textContent='actualizado '+ftime(new Date().toISOString());
    var wc=w.warnCount||0;
    if(wc>0){var b=document.getElementById('errbadge');b.textContent=wc+' err';b.style.display='inline-block';}
  }).catch(function(){});
}

var nb=document.getElementById('nb');
function setNOn(){notifOk=true;nb.textContent='Alertas ON';nb.classList.add('on');}
if(window.Notification&&Notification.permission==='granted')setNOn();
nb.addEventListener('click',function(){
  if(!('Notification' in window)){alert('Tu navegador no soporta notificaciones.');return;}
  if(Notification.permission==='granted'){setNOn();return;}
  if(Notification.permission==='denied'){alert('Notificaciones bloqueadas en tu navegador.');return;}
  Notification.requestPermission().then(function(p){if(p==='granted')setNOn();});
});

function animNum(el,from,to,dur,fmt){
  var t0=performance.now();
  function step(now){
    var p=Math.min((now-t0)/dur,1),e=1-Math.pow(1-p,3);
    el.textContent=fmt(from+(to-from)*e);
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function flashBanner(){
  var b=document.getElementById('earn');
  b.classList.remove('flash');void b.offsetWidth;b.classList.add('flash');
}

function updateEarnings(te){
  if(te>prevEarned&&notifOk){var d=(te-prevEarned).toFixed(6);try{new Notification('Pago Moltlaunch',{body:d+' ETH',tag:'cp',requireInteraction:false});}catch(ex){}}
  prevEarned=te;
}

function setPriceCards(p){
  ourPrice=p;
  document.getElementById('mkt-our').textContent=p.toFixed(6)+' ETH';
  document.getElementById('prc-eth').textContent=p.toFixed(6)+' ETH';
  if(ethUsd){
    document.getElementById('mkt-our-usd').textContent='$'+fN(p*ethUsd,2)+' USD';
    document.getElementById('mkt-our-clp').textContent='$'+Math.round(p*ethClp).toLocaleString('es-CL')+' CLP';
    document.getElementById('prc-usd').textContent='$'+fN(p*ethUsd,2)+' USD';
    document.getElementById('prc-clp').textContent='$'+Math.round(p*ethClp).toLocaleString('es-CL')+' CLP';
  }
}

function updateMarket(mk){
  if(!mk)return;
  if(mk.ourPrice)setPriceCards(mk.ourPrice);
  if(!mk.median)return;
  document.getElementById('mkt-med').textContent=mk.median.toFixed(6)+' ETH';
  if(ethUsd)document.getElementById('mkt-med-usd').textContent='$'+fN(mk.median*ethUsd,2)+' USD';
  var pct=mk.median>0?Math.round((1-mk.ourPrice/mk.median)*100):0;
  var col=pct>=5?'#4ade80':pct>=0?'#fbbf24':'#f87171';
  var pctEl=document.getElementById('mkt-pct');
  pctEl.textContent=(pct>0?'-':'')+pct+'% vs mediana';
  pctEl.style.color=col;
  document.getElementById('mkt-nagents').textContent=mk.agents+' agentes escaneados';
  if(mk.min&&mk.max)document.getElementById('mkt-range').textContent=mk.min.toFixed(5)+' - '+mk.max.toFixed(5)+' ETH';
  document.getElementById('mkt-ts').textContent='escan. '+ftime(mk.lastScan);
}

function ethLine(eth){
  if(!eth||eth<=0)return'';
  var s=eth+' ETH';
  if(ethUsd)s+=' = $'+fN(eth*ethUsd,2)+' USD / $'+Math.round(eth*ethClp).toLocaleString('es-CL')+' CLP';
  return s;
}

function loadStatus(){
  afetch('/api/status').then(function(st){
    if(!st||!st.status)return;
    document.getElementById('st').innerHTML='<span class="'+(dC[st.status]||'dot')+'"></span>'+st.status;
    document.getElementById('hst').innerHTML='<span class="'+(dC[st.status]||'dot')+'"></span>'+st.status+' - '+fmt(st.uptime||0);
    document.getElementById('up').textContent=fmt(st.uptime||0);
    document.getElementById('wal').textContent=st.wallet?st.wallet.slice(0,6)+'...'+st.wallet.slice(-4):'-';
    document.getElementById('poll-cnt').textContent=st.pollCount||0;
    document.getElementById('claim-cnt').textContent=st.claimAttempts||0;
  }).catch(function(e){
    document.getElementById('hst').innerHTML='<span class="dot off"></span>offline ('+(e&&e.message?e.message.slice(0,30):'fetch fail')+')';
  });
}
function loadPrice(){
  afetch('/api/price').then(function(pr){
    if(!pr||!pr.usd)return;
    ethUsd=pr.usd;ethClp=pr.clp;
    loadWallet();
  }).catch(function(){});
}
function loadJobs(){
  afetch('/api/jobs').then(function(jd){
    if(!jd)return;
    updateEarnings(jd.totalEarned||0);
    var jcount=jd.count||0;
    if(jcount>prevJC&&prevJC>0&&notifOk&&jd.jobs&&jd.jobs[0]){try{new Notification('Nuevo trabajo',{body:jd.jobs[0].description.slice(0,80),tag:'cj',requireInteraction:false});}catch(ex){}}
    prevJC=jcount;
    var jobs=jd.jobs||[];
    document.getElementById('jbadge').textContent=(jd.completed||0)+' completados';
    document.getElementById('jcnt').textContent=jobs.length?(jd.completed||0)+' completados - '+jobs.length+' total':'Sin trabajos aun';
    var jel=document.getElementById('jlist');
    jel.innerHTML=jobs.length?jobs.map(function(j){
      var es=j.earnedEth?'<div class="je">'+ethLine(j.earnedEth)+'</div>':'';
      return '<div class="jr"><span class="bdg '+j.status+'">' +j.status+'</span><div class="jb"><div class="jd">'+(j.description||'').replace(/</g,'&lt;')+'</div><div class="jm">'+fdate(j.startTime)+' - '+fdur(j.startTime,j.completedTime)+'</div></div>'+es+'</div>';
    }).join(''):'<div class="empty">Esperando primer trabajo del marketplace...</div>';
  }).catch(function(){});
}
function loadMarket(){
  afetch('/api/market').then(function(mk){updateMarket(mk);}).catch(function(){});
}
function loadLogs(){
  afetch('/api/logs').then(function(ls){
    if(!Array.isArray(ls))return;
    document.getElementById('lcnt').textContent=ls.length+' eventos';
    var lel=document.getElementById('llist');
    lel.innerHTML=ls.length?[].concat(ls).reverse().map(function(l){
      var msg=(l.msg||'').replace(/</g,'&lt;');
      var em=msg.match(/([0-9.]+)\\s*ETH/);
      if(em&&ethUsd){var eth=parseFloat(em[1]);msg+=' <span style="color:#4ade80;font-weight:bold">($'+fN(eth*ethUsd,2)+' USD / $'+Math.round(eth*ethClp).toLocaleString('es-CL')+' CLP)</span>';}
      return '<div class="log '+(l.type||'')+'"><span class="t">'+ftime(l.time)+'</span><span class="msg">'+msg+'</span></div>';
    }).join(''):'<div class="empty">Sin actividad aun</div>';
  }).catch(function(){});
}
function loadBounties(){
  afetch('/api/bounties').then(function(bd){
    if(!bd)return;
    document.getElementById('b-today').textContent=bd.submittedToday||0;
    document.getElementById('b-total').textContent=bd.submittedTotal||0;
    document.getElementById('b-pending').textContent=bd.pendingCount||0;
    document.getElementById('b-blacklist').textContent=(bd.blacklistedCount||0)+' bloqueados';
    if(bd.lastSubmission){var ls=bd.lastSubmission;document.getElementById('b-lasttok').textContent=(ls.amount||'?')+' '+(ls.token||'');document.getElementById('b-lastscore').textContent='score '+(ls.score||'?')+'/10';}
    var bmode=document.getElementById('bmode');
    if(bd.dryRun===false){bmode.textContent='live';bmode.className='mode-badge mode-live';}
    else{bmode.textContent='dry-run';bmode.className='mode-badge mode-dry';}
    document.getElementById('bts').textContent='actualizado '+ftime(new Date().toISOString());
    // Plain-Spanish scan summary
    var statusEl=document.getElementById('bstatus');
    var bl=bd.lastScan;
    if(bl){
      var s=bl.stats||{};
      var newBounties=(s.expired||0)+(s.noAmount||0)+(s.dust||0)+(s.disqualified||0)+(s.candidates||0);
      var ago=Math.round((Date.now()-bl.ts)/60000);
      var agoStr=ago<1?'hace menos de 1 min':'hace '+ago+' min';
      var msg;
      if(newBounties===0){
        msg='<strong>Sin bounties nuevos</strong> — esperando que lleguen nuevos en Farcaster';
      } else if(bl.submissions&&bl.submissions.length>0){
        var subs=bl.submissions.map(function(sub){
          return '✅ <strong>Enviado</strong>: "'+sub.text.replace(/</g,'&lt;').slice(0,55)+'…" — <strong>'+sub.amount+' '+(sub.token||'').toUpperCase()+'</strong>, score '+sub.score+'/10';
        }).join('<br>');
        msg=newBounties+' bounties nuevos revisados<br>'+subs;
      } else if(s.candidates>0){
        msg=newBounties+' bounties nuevos revisados · '+s.candidates+' evaluados con IA · <strong>ninguno pasó el mínimo de calidad (8/10)</strong>';
      } else {
        msg=newBounties+' bounties nuevos, <strong>ninguno elegible</strong> (filtrados antes de IA)';
      }
      statusEl.innerHTML='<span style="color:#94a3b8">'+agoStr+'</span> — '+msg;
    } else {
      statusEl.textContent='Esperando primer ciclo de bounties...';
    }
    var pendUsd=(bd.recent||[]).filter(function(b){return (b.token||'').toUpperCase()==='USDC';}).reduce(function(acc,b){return acc+(b.amount||0);},0);
    document.getElementById('roi-pend').textContent='$'+fN(pendUsd,0);
    var claudeCostEst=parseFloat((document.getElementById('roi-cost').textContent||'0').replace(/[^0-9.]/g,''))||0;
    var roiNet=pendUsd-claudeCostEst;
    var roiEl=document.getElementById('roi-net');
    var roiV=document.getElementById('roi-verdict');
    if(pendUsd>0&&claudeCostEst>0){
      if(pendUsd>claudeCostEst){roiEl.textContent='+$'+fN(pendUsd-claudeCostEst,2);roiEl.style.color='#4ade80';roiV.textContent='positivo si te pagan';}
      else{roiEl.textContent='-$'+fN(claudeCostEst-pendUsd,2);roiEl.style.color='#f87171';roiV.textContent='costo Claude > pendiente';}
    }else if(pendUsd>0){roiEl.textContent='$'+fN(pendUsd,2)+' pend.';roiEl.style.color='#fbbf24';roiV.textContent='esperando que te paguen';}
    else{roiEl.textContent='—';roiEl.style.color='#64748b';roiV.textContent='sin bounties enviados aún';}
    var bel=document.getElementById('blist');
    var items=bd.recent||[];
    bel.innerHTML=items.length?items.map(function(b){
      var tag='<span class="btag sent">enviado</span>';
      var desc=(b.text||b.bountyText||b.description||'').replace(/</g,'&lt;').slice(0,90);
      var amt=b.amount?('<strong>'+(b.amount)+' '+(b.token||'').toUpperCase()+'</strong>'):'';
      var sc=b.score?(' · score '+b.score+'/10'):'';
      var ts=b.submittedAt?' · '+ftime(b.submittedAt):'';
      return '<div class="bitem">'+tag+'<div class="bmsg">'+desc+'</div><div class="bamt">'+amt+sc+ts+'</div></div>';
    }).join(''):'';
    var bmore=document.getElementById('bmore');
    if((bd.submittedTotal||0)>5)bmore.style.display='block';
  }).catch(function(){});
}
var _allBountiesLoaded=false;
function loadMoreBounties(){
  if(_allBountiesLoaded)return;
  _allBountiesLoaded=true;
  afetch('/api/bounties?all=1').then(function(bd){
    if(!bd||!bd.recent)return;
    var bel=document.getElementById('blist');
    bel.innerHTML=bd.recent.map(function(b){
      var tag='<span class="btag sent">enviado</span>';
      var desc=(b.text||b.bountyText||b.description||'').replace(/</g,'&lt;').slice(0,90);
      var amt=b.amount?('<strong>'+(b.amount)+' '+(b.token||'').toUpperCase()+'</strong>'):'';
      var sc=b.score?(' · score '+b.score+'/10'):'';
      var ts=b.submittedAt?' · '+fdate(b.submittedAt):'';
      return '<div class="bitem">'+tag+'<div class="bmsg">'+desc+'</div><div class="bamt">'+amt+sc+ts+'</div></div>';
    }).join('');
    document.getElementById('bmore').style.display='none';
  }).catch(function(){});
}
function showErrors(){document.getElementById('llist').scrollIntoView({behavior:'smooth'});}
function load(){loadStatus();loadPrice();loadJobs();loadMarket();loadLogs();loadBounties();}

function schedLoad(){clearTimeout(loadTmr);loadTmr=setTimeout(load,300);}

var ldot=document.getElementById('ldot');
function connectSSE(){
  var es=new EventSource(_tq('/events'));
  es.addEventListener('open',function(){ldot.classList.add('on');});
  es.onmessage=function(ev){
    try{
      var d=JSON.parse(ev.data);
      if(d.type==='price'){ethUsd=d.usd;ethClp=d.clp;if(ourPrice>0)setPriceCards(ourPrice);loadWallet();}
      if(d.type==='update')schedLoad();
      if(d.type==='market')updateMarket(d);
    }catch(ex){}
  };
  es.onerror=function(){ldot.classList.remove('on');es.close();setTimeout(connectSSE,5000);};
}
function snapShowModal(t){var m=document.createElement('div');m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';var inner=document.createElement('div');inner.style.cssText='background:#1e293b;border-radius:10px;padding:16px;max-width:95vw;width:540px;max-height:80vh;display:flex;flex-direction:column;gap:10px';var h=document.createElement('div');h.style.cssText='color:#38bdf8;font-weight:bold;font-size:.9em';h.textContent='Selecciona todo y copia (Ctrl+A entonces Ctrl+C)';var ta=document.createElement('textarea');ta.readOnly=true;ta.value=t;ta.style.cssText='flex:1;min-height:260px;background:#0f172a;color:#cbd5e1;border:1px solid #334155;border-radius:6px;padding:10px;font-size:.75em;font-family:monospace;resize:none';var b=document.createElement('button');b.textContent='Cerrar';b.style.cssText='background:#0ea5e9;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer';b.onclick=function(){m.remove();};inner.appendChild(h);inner.appendChild(ta);inner.appendChild(b);m.appendChild(inner);document.body.appendChild(m);ta.focus();ta.select();}
function copySnapshot(){
  var btn=document.getElementById('snpbtn');
  function markOk(){btn.textContent='Copiado!';btn.classList.add('on');setTimeout(function(){btn.textContent='Copiar todo';btn.classList.remove('on');},2500);}
  fetch(_tq('/snapshot')).then(function(r){return r.text();}).then(function(txt){
    function doFallback(){var ta=document.createElement('textarea');ta.value=txt;ta.style.cssText='position:fixed;opacity:0;top:0;left:0';document.body.appendChild(ta);ta.focus();ta.select();var ok=false;try{ok=document.execCommand('copy');}catch(e){}document.body.removeChild(ta);if(ok)markOk();else snapShowModal(txt);}
    if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(txt).then(markOk).catch(doFallback);}else{doFallback();}
  }).catch(function(){btn.textContent='Error';setTimeout(function(){btn.textContent='Copiar todo';},2500);});
}
function fallbackCopy(txt,btn){
  var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');btn.textContent='Copiado!';btn.classList.add('ok');setTimeout(function(){btn.textContent='Copiar';btn.classList.remove('ok');},2000);}
  catch(e){btn.textContent='Error';}
  document.body.removeChild(ta);
}
connectSSE();
load();
loadWallet();
setInterval(load,30000);
setInterval(loadWallet,5*60*1000);
<\/script>
</body></html>`;

function checkAuth(req, res) {
  if (!DASHBOARD_SECRET) return true;
  const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
  const params = new URLSearchParams(qs);
  const token = params.get('token') || req.headers['x-dashboard-token'] || '';
  if (token === DASHBOARD_SECRET) return true;
  res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="CashClaw"' });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ ok: true, status: cashclawStatus, uptime: Math.floor((Date.now() - startTime) / 1000) }));
  }
  if (!checkAuth(req, res)) return;
  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': '*' });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.push(res);
    req.on('close', () => { const i = sseClients.indexOf(res); if (i >= 0) sseClients.splice(i, 1); });
    return;
  }
  if (url === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const event = JSON.parse(body);
        const type = event.type || event.event || 'evento';
        console.log('[WEBHOOK] Push recibido:', type, JSON.stringify(event).slice(0, 200));
        addLog('Tarea llegó via webhook: ' + type + (event.taskId ? ' #' + event.taskId : ''), 'info');
      } catch(e) { console.log('[WEBHOOK] Payload inválido:', body.slice(0, 100)); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }
  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ agent: process.env.AGENT_ID, wallet: process.env.WALLET_ADDRESS,
      uptime: Math.floor((Date.now() - startTime) / 1000), status: cashclawStatus, lastActivity,
      completedJobs: completedJobsCount, totalEarned: totalEarnedEth, restarts: restartCount,
      pollCount, claimAttempts, lastPollTime }));
  }
  if (url === '/api/price') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(ethPrice));
  }
  if (url === '/api/market') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(marketData));
  }
  if (url === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(logs));
  }
  if (url === '/snapshot') {
    const today = new Date().toISOString().slice(0, 10);
    const submitted = bountyState.bountiesSubmitted || [];
    const sep = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    const lines = [
      '=== CashClaw · ' + new Date().toLocaleString('es-CL') + ' ===',
      '',
      'Uptime: ' + (process.uptime() | 0) + 's',
      'Wallet: ' + (process.env.WALLET_ADDRESS || '?'),
      '[DIAG] HOME=' + os.homedir() + ' UID=' + (process.getuid ? process.getuid() : 'n/a') + ' DATA_DIR=' + (process.env.DATA_DIR || 'no set') + ' writable=' + _dataDirWritable,
      'Wallet ETH: ' + (walletEth !== null ? walletEth.toFixed(6) + ' ETH' : 'sin datos (espera ~1 min)'),
      'Wallet USDC: ' + (walletUsdc !== null ? walletUsdc.toFixed(2) + ' USDC' : 'sin datos'),
      'Jobs Moltlaunch: ' + completedJobsCount,
      'Claude calls: ' + getClaudeCallCount() + ' (~$' + (getClaudeCallCount() * 0.003).toFixed(2) + ' USD est.)',
      'Alertas/errores: ' + warnCount,
      'ETH/USD: ' + (ethPrice.usd ? '$' + ethPrice.usd : 'N/A'),
      '',
      '--- Mercado ---',
      'Agentes: ' + (marketData.agents || '-') + ' | Mediana: ' + (marketData.median ? marketData.median.toFixed(6) : '-') + ' ETH',
      'Nuestro precio: ' + (marketData.ourPrice ? marketData.ourPrice.toFixed(6) : '-') + ' ETH',
      'Rango mercado: ' + (marketData.min ? marketData.min.toFixed(6) : '-') + ' – ' + (marketData.max ? marketData.max.toFixed(6) : '-') + ' ETH',
      '',
      '--- Bounties Farcaster ---',
      'Modo: ' + (process.env.BOUNTY_AUTOPOST === '1' ? 'LIVE' : 'DRY-RUN'),
      'Evaluados: ' + Object.keys(bountyState.bountiesSeen || {}).length + ' | Enviados hoy: ' + submitted.filter(s => s.date === today).length + ' | Total: ' + submitted.length,
      submitted.length > 0 ? 'Último envío: ' + (submitted[submitted.length-1].amount || '?') + ' ' + (submitted[submitted.length-1].token || '').toUpperCase() + ' — score ' + (submitted[submitted.length-1].score || '?') + '/10 — ' + new Date(submitted[submitted.length-1].submittedAt || 0).toLocaleString('es-CL') : 'Sin envíos aún',
      'Memoria: ' + (persistInfo.fallback ? '🔴 DATA_DIR no escribible — Volume NO montado, estado se pierde al redeploy' : !persistInfo.usingVolume ? '⚠️ temporal (configura DATA_DIR + Volume en Railway)' : persistInfo.restored ? '💾 Volume OK — datos del deploy anterior cargados' : '💾 Volume OK — primer arranque'),
      '',
      sep,
      'REGISTROS (' + logs.length + ' entradas — más reciente primero)',
      sep,
      ...[...logs].reverse().map(l => '[' + (l.time || '') + '] ' + (l.msg || l.message || JSON.stringify(l)))
    ];
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(lines.join('\n'));
  }
  if (url === '/api/wallet') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      eth: walletEth,
      usdc: walletUsdc,
      address: process.env.WALLET_ADDRESS || '0xccba4f45bc42877e9d4abc5fc3f66c208c9bb1cb',
      lastCheck: walletLastCheck,
      claudeCalls: getClaudeCallCount(),
      warnCount
    }));
  }
  if (url === '/api/bounties') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    const today = new Date().toISOString().slice(0, 10);
    const submitted = bountyState.bountiesSubmitted || [];
    const last = submitted.length > 0 ? submitted[submitted.length - 1] : null;
    const showAll = req.url.includes('all=1');
    return res.end(JSON.stringify({
      submittedToday: submitted.filter(s => s.date === today).length,
      submittedTotal: submitted.length,
      recent: showAll ? submitted.slice().reverse() : submitted.slice(-5).reverse(),
      seenTotal: Object.keys(bountyState.bountiesSeen || {}).length,
      pendingCount: (bountyState.bountiesPending || []).length,
      blacklistedCount: Object.keys(bountyState.blacklistedFids || {}).length,
      dryRun: process.env.BOUNTY_AUTOPOST !== '1',
      lastSubmission: last ? {
        amount: last.amount,
        token: (last.token || '').toUpperCase(),
        score: last.score,
        text: (last.text || '').slice(0, 100),
        at: last.submittedAt
      } : null,
      lastScan
    }));
  }
  if (url === '/api/jobs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ jobs, totalEarned: totalEarnedEth, completed: completedJobsCount, count: jobs.length }));
  }
  if (url === '/connect-farcaster') {
    const currentUuid = farcasterSignerUuid || '';
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    return res.end('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar Farcaster</title><script src="https://neynarxyz.github.io/siwn/raw/1.2.0/index.js" async><\/script></head><body style="font-family:-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;margin:0;padding:20px"><div style="max-width:480px;margin:0 auto;padding-top:40px"><h1 style="color:#38bdf8;margin-bottom:8px;text-align:center">Conectar Farcaster</h1>'
      + (currentUuid ? '<div style="background:#052e16;border:1px solid #15803d;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center"><div style="color:#4ade80;font-weight:bold;margin-bottom:6px">Ya conectado</div><div style="font-size:.75em;color:#86efac;word-break:break-all">' + currentUuid + '</div></div>' : '<p style="color:#94a3b8;margin-bottom:24px;text-align:center">Toca el boton para conectar @jabenoitv.</p>')
      + '<div style="display:flex;justify-content:center;margin-bottom:24px"><div class="neynar_signin" data-client_id="' + NEYNAR_CLIENT_ID + '" data-success-callback="onSIWN" data-theme="dark" data-variant="warpcast"></div></div>'
      + '<div id="msg"></div>'
      + '<div style="margin-top:24px;background:#1e293b;border-radius:8px;padding:16px"><div style="color:#94a3b8;font-size:.8em;margin-bottom:8px">O pega el UUID manualmente:</div><input id="manual" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;padding:8px 10px;font-size:.85em;margin-bottom:8px"><button onclick="submitManual()" style="background:#0ea5e9;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:.85em">Guardar UUID</button><div id="manual-msg" style="font-size:.75em;margin-top:6px"></div></div>'
      + '<br><div style="text-align:center"><a href="/" style="color:#475569;font-size:.85em">Volver al dashboard</a></div></div>'
      + '<script>function extractUuid(d){return d.signer_uuid||d.signerUuid||d.signer||d.signerID||(d.signer_approved&&d.signer)||(d.data&&(d.data.signer_uuid||d.data.signerUuid))||null;}'
      + 'function copyVars(){var el=document.getElementById("varblock");if(!el)return;var txt=el.innerText||el.textContent;var btn=document.getElementById("copybtn");if(navigator.clipboard){navigator.clipboard.writeText(txt).then(function(){btn.textContent="Copiado!";btn.style.background="#15803d";setTimeout(function(){btn.textContent="Copiar todo";btn.style.background="#0ea5e9";},2000);});}else{var ta=document.createElement("textarea");ta.value=txt;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");btn.textContent="Copiado!";btn.style.background="#15803d";setTimeout(function(){btn.textContent="Copiar todo";btn.style.background="#0ea5e9";},2000);}catch(e){}document.body.removeChild(ta);}}'
      + 'window.onSIWN=function(d){'
      + 'var uuid=extractUuid(d);'
      + 'var raw=JSON.stringify(d,null,2);'
      + 'var html="";'
      + 'if(uuid){'
      + 'var vars="FARCASTER_SIGNER_UUID="+uuid+"\\nBOUNTY_AUTOPOST=0";'
      + 'html="<div style=\'background:#0a1628;border:1px solid #15803d;border-radius:10px;padding:16px;margin-bottom:12px\'>";'
      + 'html+="<div style=\'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px\'><span style=\'color:#4ade80;font-weight:bold;font-size:1em\'>Variables para Railway</span><button id=\'copybtn\' onclick=\'copyVars()\' style=\'background:#0ea5e9;color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:.82em;font-weight:bold\'>Copiar todo</button></div>";'
      + 'html+="<pre id=\'varblock\' style=\'background:#052e16;border:1px solid #166534;border-radius:6px;padding:12px;color:#86efac;font-size:.88em;line-height:1.7;margin:0;white-space:pre-wrap;word-break:break-all\'>"+vars+"</pre>";'
      + 'html+="<div style=\'color:#475569;font-size:.7em;margin-top:8px\'>Pega ambas líneas en Railway → Variables. Cambia BOUNTY_AUTOPOST a 1 cuando quieras modo live.</div>";'
      + 'html+="</div>";}else{html="<div style=\'background:#1e293b;border-radius:8px;padding:16px;margin-bottom:12px\'><div style=\'color:#f59e0b;margin-bottom:6px\'>signer_uuid no encontrado en el callback. Raw data:</div><pre style=\'color:#94a3b8;font-size:.65em;text-align:left;word-break:break-all;margin-top:8px;overflow:auto;max-height:200px\'>"+raw+"</pre></div>";}'
      + 'document.getElementById("msg").innerHTML=html;'
      + 'if(uuid)fetch("/siwn",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}).catch(function(){});'
      + '};'
      + 'function submitManual(){var v=document.getElementById("manual").value.trim();if(!v){document.getElementById("manual-msg").innerHTML="<span style=\'color:#f87171\'>Ingresa un UUID</span>";return;}fetch("/siwn?signer_uuid="+encodeURIComponent(v)+"&fid=&username=jabenoitv").then(function(r){return r.json();}).then(function(r){if(r.ok)document.getElementById("manual-msg").innerHTML="<span style=\'color:#4ade80\'>Guardado! Recarga el dashboard.</span>";else document.getElementById("manual-msg").innerHTML="<span style=\'color:#f87171\'>Error: "+JSON.stringify(r)+"</span>";}).catch(function(e){document.getElementById("manual-msg").innerHTML="<span style=\'color:#f87171\'>Error: "+e.message+"</span>";});}'
      + '<\/script></body></html>');
  }
  if (url === '/siwn') {
    const handleSiwn = (signerUuid, fid, username) => {
      console.warn('[SEGURIDAD] *** /siwn recibido *** signer_uuid=' + (signerUuid||'(vacio)') + ' fid=' + (fid||'?') + ' username=' + (username||'?') + ' ip=' + (req.socket && req.socket.remoteAddress || '?'));
      if (!signerUuid) { res.writeHead(400, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'no signer_uuid'})); }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(signerUuid)) {
        console.warn('[SEGURIDAD] /siwn RECHAZADO: signer_uuid con formato invalido');
        res.writeHead(400, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'invalid signer_uuid format'}));
      }
      farcasterSignerUuid = signerUuid;
      saveState();
      console.log('[FARCASTER] *** SIGNER UUID GUARDADO ***');
      console.log('[FARCASTER] FARCASTER_SIGNER_UUID=' + signerUuid);
      console.log('[FARCASTER] Conectado: @' + (username||'?') + ' FID:' + (fid||'?'));
      addLog('Farcaster conectado: @' + (username||'jabenoitv'), 'info');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true, signer_uuid:signerUuid, username:username, fid:fid}));
    };
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body);
          const uuid = d.signer_uuid || d.signerUuid || d.signer || d.signerID
            || (d.data && (d.data.signer_uuid || d.data.signerUuid)) || null;
          console.log('[FARCASTER] raw callback:', JSON.stringify(d).slice(0, 300));
          handleSiwn(uuid, d.fid || (d.user && d.user.fid), d.username || (d.user && d.user.username));
        } catch(e) { res.writeHead(400); res.end('bad json'); }
      });
    } else {
      const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
      const p = new URLSearchParams(qs);
      handleSiwn(p.get('signer_uuid'), p.get('fid'), p.get('username'));
    }
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(DASHBOARD_HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard listo en http://0.0.0.0:' + PORT);
  if (persistInfo.fallback) {
    addLog('⚠️ Memoria: DATA_DIR=' + process.env.DATA_DIR + ' no es escribible [' + _dataDirWriteErr + '] — usando disco temporal', 'warn');
  } else if (!persistInfo.usingVolume) {
    addLog('⚠️ Memoria: disco temporal — se borrará al redesplegar (configura DATA_DIR con un Railway Volume)', 'warn');
  } else if (persistInfo.restored) {
    addLog('💾 Memoria: Volume OK — restaurada: ' + persistInfo.submittedCount + ' envíos, ' + persistInfo.seenCount + ' vistos', 'info');
  } else if (persistInfo.stateFileExistedAtBoot) {
    addLog('⚠️ Memoria: state.json encontrado pero vacío/corrupto en ' + DATA_DIR, 'warn');
  } else {
    addLog('💾 Memoria: Volume OK — primer arranque (sin estado previo, escribiendo en ' + DATA_DIR + ')', 'info');
  }
  startCashclaw();
  startBountyEngine({
    neynarApiKey: NEYNAR_API_KEY,
    signerUuid: farcasterSignerUuid,
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    verifiedAddress: '0xccba4f45bc42877e9d4abc5fc3f66c208c9bb1cb',
    getEthPriceUsd: () => ethPrice.usd || 0,
    getState: () => bountyState,
    saveState: (s) => { bountyState = s; saveState(); },
    dryRun: process.env.BOUNTY_AUTOPOST !== '1',
    onEvent: (type, data) => {
      if (type === 'wallet_balance') {
        walletEth = data.eth;
        walletUsdc = data.usdc;
        walletLastCheck = Date.now();
        broadcast({ type: 'update' });
      } else if (type === 'payout') {
        const msg = 'Bounty pagado: ' + data.amount + ' ' + data.token;
        addLog(msg, 'info');
        broadcast({ type: 'update' });
        postToFarcaster('Bounty completed + paid on @bountycaster! ' + data.amount + ' ' + data.token + ' received. Autonomous agent @jabenoitv open for work on Farcaster.');
      } else if (type === 'bounty_submitted') {
        broadcast({ type: 'update' });
      } else if (type === 'scan_complete') {
        lastScan = data;
        broadcast({ type: 'update' });
      } else if (type === 'nonpayer') {
        const { username, entry } = data;
        const tok = (entry.token || '').toUpperCase();
        // Public post only if NONPAYER_AUTOPOST=1 — default off, requires explicit opt-in
        if (process.env.NONPAYER_AUTOPOST === '1') {
          postToFarcaster('⚠️ Bounty de @' + username + ' (' + entry.amount + ' ' + tok + ') sin pago tras 14 días. Entregué respuesta calificada ' + entry.score + '/10. @bountybot #bountycaster');
        }
        addLog('[BOUNTY] No-pagador detectado: @' + username + ' — ' + entry.amount + ' ' + tok + (process.env.NONPAYER_AUTOPOST !== '1' ? ' (activa NONPAYER_AUTOPOST=1 para publicar)' : ''), 'warn');
        broadcast({ type: 'update' });
      } else {
        addLog(String(data || type), type === 'warn' ? 'warn' : 'info');
      }
    }
  });
  setTimeout(() => {
    postToFarcaster('CashClaw #' + AGENT_ID + ' online on @moltlaunch. Writing, coding, research, data extraction, EN↔ES translation — 1-4h delivery, never sleeps. moltlaunch.com/agents/51049');
  }, 60000);
});
server.on('error', err => { console.error('Error servidor:', err.message); process.exit(1); });
