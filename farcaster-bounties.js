'use strict';
const https = require('https');

// @bountybot FID on Farcaster
const BOUNTYBOT_FID = 20596;
const ORIGIN = 'https://jabenoitv-production.up.railway.app';

// Quality gates
const MIN_CONFIDENCE = 0.80;
const MIN_SELF_SCORE = 8;
const MAX_SUBMISSIONS_PER_DAY = 5;
const SUBMIT_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_BOUNTY_VALUE_USD = 1.0;
const SCAN_INTERVAL_MS = 25 * 60 * 1000; // every 25 min
const PAYOUT_POLL_MS = 5 * 60 * 1000;    // balance check every 5 min

// Text-only competencies
const ELIGIBLE_CATEGORIES = [
  'writing','copywriting','content','blog','email','thread','caption',
  'research','summarize','summary','analysis','report','review',
  'translation','translate','transcription','proofreading','editing',
  'question','answer','explain','brainstorm','plan','advice','consulting',
  'list','compile','categorize','draft','describe'
];

// Hard disqualifiers (pre-Claude filter, cheap)
const DISQUALIFY_PATTERNS = [
  /\b(code|program|script|bug fix|pull request|pr|deploy|build|compile|execute|run)\b/i,
  /\b(design|logo|banner|image|video|audio|music|animation|art|illustration|photo)\b/i,
  /\b(first (one|to)|fastest|most|highest|win|competition)\b/i,
  /\b(login|account|password|credentials|personal data|kyc)\b/i,
  /\b(nsfw|adult|illegal|hack|exploit)\b/i,
  /\b(onchain|on-chain|smart contract|solidity|deploy|mint|nft)\b/i
];

function neynarGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.neynar.com', path, method: 'GET',
      headers: { 'api_key': apiKey, 'Origin': ORIGIN, 'Referer': ORIGIN + '/' }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Neynar ' + res.statusCode + ': ' + d.slice(0, 120)));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Neynar parse: ' + d.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function neynarPost(path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const buf = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.neynar.com', path, method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'api_key': apiKey,
        'Content-Length': Buffer.byteLength(buf), 'Origin': ORIGIN, 'Referer': ORIGIN + '/'
      }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200 && res.statusCode !== 201)
          return reject(new Error('Neynar POST ' + res.statusCode + ': ' + d.slice(0, 120)));
        try { resolve(JSON.parse(d)); } catch (e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function claudeChat(messages, system, anthropicKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Claude ' + res.statusCode + ': ' + d.slice(0, 120)));
        try {
          const r = JSON.parse(d);
          resolve(r.content && r.content[0] ? r.content[0].text : '');
        } catch (e) { reject(new Error('Claude parse: ' + d.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function baseRpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request({
      hostname: 'mainnet.base.org', path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { const r = JSON.parse(d); r.error ? reject(new Error(r.error.message)) : resolve(r.result); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Parse bounty amount from cast text (e.g. "10 USDC", "$50", "0.01 ETH", "100 DEGEN")
function parseBountyAmount(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(usdc|eth|degen|op|usd|\$)/i)
    || text.match(/\$(\d+(?:\.\d+)?)/i);
  if (!m) return { amount: 0, token: 'unknown' };
  const raw = m[1] || m[0].replace(/[^0-9.]/g, '');
  const token = (m[2] || 'usd').toLowerCase().replace('$', 'usd');
  return { amount: parseFloat(raw) || 0, token };
}

// Estimate USD value of bounty
function estimateUsd(amount, token, ethPriceUsd) {
  if (!amount) return 0;
  if (token === 'usdc' || token === 'usd') return amount;
  if (token === 'eth') return amount * (ethPriceUsd || 2000);
  if (token === 'degen') return amount * 0.002;
  if (token === 'op') return amount * 1.5;
  return amount * 0.01; // unknown token, conservative
}

async function fetchBounties(apiKey) {
  // Fetch @bountybot's (FID 20596) own reply casts — free Neynar endpoint.
  // @bountybot replies to every bounty it acknowledges, so parent_hash on
  // each reply points to the original bounty cast we should submit work to.
  const data = await neynarGet(
    '/v2/farcaster/feed/user/casts?fid=20596&limit=50&include_replies=true',
    apiKey
  );
  const casts = data.casts || [];
  return casts.filter(c => {
    // Only process @bountybot's reply casts (not its own top-level posts)
    if (!c.parent_hash) return false;
    // Skip casts that look like payment confirmations ("paid", "closed")
    const low = (c.text || '').toLowerCase();
    if (/paid|closed|completed|winner|rewarded/i.test(low)) return false;
    return true;
  }).map(c => {
    const { amount, token } = parseBountyAmount(c.text || '');
    return {
      hash: c.parent_hash,       // original bounty cast — where we reply
      confirmHash: c.hash,       // bountybot's acknowledgement cast
      authorUsername: (c.parent_author && c.parent_author.username) || 'unknown',
      authorFid: c.parent_author && c.parent_author.fid,
      text: c.text || '',        // bountybot's confirmation text (has task description)
      timestamp: c.timestamp,
      amount,
      token
    };
  }).filter(b => b.hash);
}

async function classifyBounty(bounty, anthropicKey) {
  const prompt = `You are evaluating whether an AI text agent can complete this Farcaster bounty.

Bounty text: "${bounty.text}"

The agent CAN do: writing, copywriting, research, summarization, Q&A, translation (EN/ES), content drafting, analysis of provided text, brainstorming, compiling information, blog posts, threads, captions, plans, reports.

The agent CANNOT do: write/run code, create images/video/audio, physical tasks, login to accounts, on-chain actions, "first to achieve X" competitions, anything NSFW or illegal.

Return ONLY valid JSON (no markdown): {"eligible": true/false, "category": "string", "confidence": 0.0-1.0, "reason": "one sentence", "deliverable_type": "string"}`;

  const text = await claudeChat(
    [{ role: 'user', content: prompt }],
    'You classify bounties for an autonomous AI agent. Return only JSON.',
    anthropicKey
  );
  try {
    const clean = text.replace(/```json?|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return { eligible: false, confidence: 0, reason: 'parse error', category: 'unknown' };
  }
}

async function generateDeliverable(bounty, anthropicKey) {
  const prompt = `Complete this Farcaster bounty task. Write a high-quality, direct deliverable.

Bounty: "${bounty.text}"

Requirements:
- Deliver the actual work, not a description of it
- Be concise but complete (Farcaster replies have a ~1024 char limit, so be efficient)
- If translation EN→ES or ES→EN: provide the full translation
- If research/Q&A: provide the answer directly with key facts
- If writing/content: write the actual piece
- Do NOT include meta-commentary like "Here is my submission" or "I hope this helps"
- Start immediately with the deliverable`;

  return claudeChat(
    [{ role: 'user', content: prompt }],
    'You are an expert freelancer completing bounty tasks. Deliver high-quality work directly.',
    anthropicKey
  );
}

async function critiqueDeliverable(bounty, draft, anthropicKey) {
  const prompt = `Rate this bounty submission on a scale of 0-10.

Original bounty: "${bounty.text}"

Submission: "${draft}"

Evaluate: completeness, quality, accuracy, relevance to what was asked.
Be strict - only give 8+ if the submission genuinely meets or exceeds what was requested.

Return ONLY valid JSON: {"score": 0-10, "issues": ["issue1", "issue2"]}`;

  const text = await claudeChat(
    [{ role: 'user', content: prompt }],
    'You are a strict quality reviewer. Return only JSON.',
    anthropicKey
  );
  try {
    const clean = text.replace(/```json?|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return { score: 0, issues: ['parse error'] };
  }
}

async function submitBounty(bounty, deliverable, apiKey, signerUuid) {
  // Reply to the bounty cast with the deliverable
  // Farcaster cast limit is 1024 chars
  const text = deliverable.slice(0, 1020);
  const body = { signer_uuid: signerUuid, text, parent: { hash: bounty.hash } };
  return neynarPost('/v2/farcaster/cast', body, apiKey);
}

function startBountyEngine({ neynarApiKey, signerUuid, anthropicKey, verifiedAddress, getEthPriceUsd, getState, saveState, onEvent, dryRun }) {
  const missing = [];
  if (!neynarApiKey) missing.push('NEYNAR_API_KEY');
  if (!signerUuid) missing.push('FARCASTER_SIGNER_UUID');
  if (!anthropicKey) missing.push('ANTHROPIC_API_KEY');
  if (missing.length) {
    onEvent('warn', '[BOUNTY] Motor inactivo — faltan env vars: ' + missing.join(', '));
    return;
  }

  const mode = dryRun ? 'DRY-RUN' : 'LIVE';
  onEvent('info', '[BOUNTY] Motor iniciado (' + mode + ') — scan cada 25 min, @bountybot FID ' + BOUNTYBOT_FID);

  async function scanBounties() {
    const state = getState();
    const seen = state.bountiesSeen || {};
    const submitted = state.bountiesSubmitted || [];
    const today = new Date().toISOString().slice(0, 10);
    const todaySubmissions = submitted.filter(s => s.date === today).length;

    if (todaySubmissions >= MAX_SUBMISSIONS_PER_DAY) {
      onEvent('info', '[BOUNTY] Límite diario alcanzado (' + MAX_SUBMISSIONS_PER_DAY + '/día)');
      return;
    }

    let bounties;
    try {
      bounties = await fetchBounties(neynarApiKey);
      onEvent('info', '[BOUNTY] ' + bounties.length + ' bounties encontrados en Farcaster');
    } catch (e) {
      onEvent('warn', '[BOUNTY] Error fetching bounties: ' + e.message);
      return;
    }

    const ethUsd = getEthPriceUsd();
    const lastSubmitTime = state.lastBountySubmit || 0;

    for (const bounty of bounties) {
      if (todaySubmissions >= MAX_SUBMISSIONS_PER_DAY) break;
      if (seen[bounty.hash]) continue;
      if (Date.now() - lastSubmitTime < SUBMIT_COOLDOWN_MS) break;

      // Mark seen regardless of outcome
      seen[bounty.hash] = Date.now();

      // Pre-filter: skip cheap dust
      const usdValue = estimateUsd(bounty.amount, bounty.token, ethUsd);
      if (usdValue < MIN_BOUNTY_VALUE_USD && bounty.amount > 0) {
        continue;
      }

      // Pre-filter: hard disqualifiers (cheap, no Claude call)
      const disqualified = DISQUALIFY_PATTERNS.some(p => p.test(bounty.text));
      if (disqualified) continue;

      // Pre-filter: must have at least one eligible keyword
      const hasEligible = ELIGIBLE_CATEGORIES.some(kw => bounty.text.toLowerCase().includes(kw));
      if (!hasEligible) continue;

      onEvent('info', '[BOUNTY] Candidato: "' + bounty.text.slice(0, 80) + '" (' + bounty.amount + ' ' + bounty.token + ')');

      // Classify with Claude
      let classification;
      try {
        classification = await classifyBounty(bounty, anthropicKey);
      } catch (e) {
        onEvent('warn', '[BOUNTY] Error clasificando: ' + e.message);
        continue;
      }

      if (!classification.eligible || classification.confidence < MIN_CONFIDENCE) {
        onEvent('info', '[BOUNTY] Skip (' + (classification.reason || 'no eligible') + ')');
        continue;
      }

      onEvent('info', '[BOUNTY] Elegible: ' + classification.category + ' (confianza ' + (classification.confidence * 100).toFixed(0) + '%)');

      // Generate deliverable
      let draft;
      try {
        draft = await generateDeliverable(bounty, anthropicKey);
      } catch (e) {
        onEvent('warn', '[BOUNTY] Error generando entregable: ' + e.message);
        continue;
      }

      // Self-critique
      let critique;
      try {
        critique = await critiqueDeliverable(bounty, draft, anthropicKey);
      } catch (e) {
        onEvent('warn', '[BOUNTY] Error en auto-revisión: ' + e.message);
        continue;
      }

      onEvent('info', '[BOUNTY] Auto-score: ' + critique.score + '/10' + (critique.issues && critique.issues.length ? ' — ' + critique.issues[0] : ''));

      if (critique.score < MIN_SELF_SCORE) {
        onEvent('info', '[BOUNTY] Score insuficiente (' + critique.score + '<' + MIN_SELF_SCORE + '), descartando');
        continue;
      }

      if (dryRun) {
        onEvent('info', '[BOUNTY] DRY-RUN — NO posteado (score ' + critique.score + '/10, ' + bounty.amount + ' ' + bounty.token + ')');
        onEvent('info', '[BOUNTY] Entregable: ' + draft.slice(0, 200));
        const s = getState();
        s.bountiesSeen = seen;
        saveState(s);
        continue;
      }

      // Submit
      try {
        await submitBounty(bounty, draft, neynarApiKey, signerUuid);
        todaySubmissions + 1; // for local guard
        const entry = {
          hash: bounty.hash,
          date: today,
          text: bounty.text.slice(0, 120),
          amount: bounty.amount,
          token: bounty.token,
          score: critique.score,
          submittedAt: new Date().toISOString()
        };
        submitted.push(entry);
        onEvent('info', '[BOUNTY] Enviado: ' + bounty.amount + ' ' + bounty.token.toUpperCase() + ' — score ' + critique.score + '/10');
        onEvent('bounty_submitted', entry);
        const s = getState();
        s.bountiesSeen = seen;
        s.bountiesSubmitted = submitted.slice(-200);
        s.lastBountySubmit = Date.now();
        saveState(s);
      } catch (e) {
        onEvent('warn', '[BOUNTY] Error enviando: ' + e.message);
      }
    }

    // Save seen state
    const s = getState();
    s.bountiesSeen = seen;
    saveState(s);
  }

  // Payout watcher — reads ETH + USDC balance on Base
  const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  let baselineEth = null;
  let baselineUsdc = null;

  async function checkPayout() {
    if (!verifiedAddress) return;
    try {
      const ethHex = await baseRpc('eth_getBalance', [verifiedAddress, 'latest']);
      const ethNow = parseInt(ethHex, 16) / 1e18;

      // USDC balanceOf(verifiedAddress)
      const callData = '0x70a08231000000000000000000000000' + verifiedAddress.slice(2).toLowerCase();
      const usdcHex = await baseRpc('eth_call', [{ to: USDC_BASE, data: callData }, 'latest']);
      const usdcNow = parseInt(usdcHex, 16) / 1e6;

      if (baselineEth === null) { baselineEth = ethNow; baselineUsdc = usdcNow; return; }

      const ethDelta = ethNow - baselineEth;
      const usdcDelta = usdcNow - baselineUsdc;

      if (usdcDelta >= 0.5) {
        onEvent('payout', { token: 'USDC', amount: usdcDelta.toFixed(2) });
        baselineUsdc = usdcNow;
      }
      if (ethDelta >= 0.0001) {
        onEvent('payout', { token: 'ETH', amount: ethDelta.toFixed(6) });
        baselineEth = ethNow;
      }
    } catch (e) {
      // silent — payout monitoring is best-effort
    }
  }

  // Initial scan after 30s (give server time to stabilize)
  setTimeout(() => {
    scanBounties().catch(e => onEvent('warn', '[BOUNTY] scan error: ' + e.message));
    setInterval(() => {
      scanBounties().catch(e => onEvent('warn', '[BOUNTY] scan error: ' + e.message));
    }, SCAN_INTERVAL_MS);
  }, 30000);

  // Payout watcher
  setTimeout(() => {
    checkPayout();
    setInterval(checkPayout, PAYOUT_POLL_MS);
  }, 60000);
}

module.exports = { startBountyEngine };
