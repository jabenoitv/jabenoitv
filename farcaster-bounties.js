'use strict';
const https = require('https');

// @bountybot FID on Farcaster
const BOUNTYBOT_FID = 20596;
const ORIGIN = 'https://jabenoitv-production.up.railway.app';
// Farcaster protocol epoch (seconds since this date → Unix ms)
const FC_EPOCH_MS = new Date('2021-01-01T00:00:00Z').getTime();

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
  /\b(code|program|script|bug fix|pull request|pr|deploy|build|compile|execute)\b/i,
  /\b(design|logo|banner|image|video|audio|music|animation|art|illustration|photo)\b/i,
  /\b(first (one|to)|fastest|most|highest|win|competition)\b/i,
  /\b(login|account|password|credentials|personal data|kyc)\b/i,
  /\b(nsfw|adult|illegal|hack|exploit)\b/i,
  /\b(onchain|on-chain|smart contract|solidity|deploy|mint|nft)\b/i,
  // "name your price" / open bidding — agent can't quote prices for its work
  // Matches "best offer", "best $ offer", "best price", "bid", etc.
  /\bbest(\s+\$)?\s+(offer|bid|price)\b|name your price|\bquote\b|\byour rate\b/i,
  // Music streaming platforms — creating playlists requires account login
  /\b(spotify|soundcloud|apple music|youtube music|tidal|deezer)\b/i,
  // Personal networking / introductions — requires real-world connections
  /\bintro(duce|duction)?\s+(me\s+to|to\s+someone|to\s+anyone)\b|\bdo\s+you\s+know\s+(anyone|someone)\b|\bconnection\s+(with|at)\b/i,
  // Live interview / meeting — requires real-time in-person interaction
  /\b(interview|user research|user study|usability test)\b.*\b(join|meet|call|zoom|google meet|schedule)\b|\b(join|meet|schedule)\b.*\b(interview|user research)\b/i,
  // Token-holding / "sign in with" spam — common Farcaster spam campaign pattern
  /\bhold\s+[\d,]+\s*\$\w+\s+to\s+unlock\b/i,
  /\bsign\s+in\s+with\b/i,
  // Referral / follow / like / recast engagement spam
  /\b(follow\s+me|recast\s+this|like\s+\d+\s+post|follow\s+&\s+recast)\b/i
];

// Purge bountiesSeen entries older than 7 days to keep state.json bounded.
// Entries are { hash: timestamp(ms) }; non-numeric timestamps are dropped.
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function purgeSeen(seen) {
  const out = {};
  const now = Date.now();
  for (const hash in seen) {
    const ts = Number(seen[hash]);
    if (Number.isFinite(ts) && (now - ts) < SEEN_TTL_MS) out[hash] = ts;
  }
  return out;
}

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

function hubApiGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'hub-api.neynar.com', path, method: 'GET',
      headers: { 'api_key': apiKey, 'Accept': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HubAPI ' + res.statusCode + ': ' + d.slice(0, 150)));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('HubAPI parse: ' + d.slice(0, 80))); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('HubAPI timeout')); });
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Neynar POST timeout')); });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function claudeChatOnce(messages, system, anthropicKey) {
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
        if (res.statusCode !== 200) {
          const err = new Error('Claude ' + res.statusCode + ': ' + d.slice(0, 120));
          err.statusCode = res.statusCode;
          return reject(err);
        }
        try {
          const r = JSON.parse(d);
          resolve(r.content && r.content[0] ? r.content[0].text : '');
        } catch (e) { reject(new Error('Claude parse: ' + d.slice(0, 80))); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Claude timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Retry wrapper: backoff on 429 (rate limit) / 529 (overloaded). 3 attempts: 2s, 4s, 8s.
async function claudeChat(messages, system, anthropicKey) {
  const delays = [2000, 4000, 8000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await claudeChatOnce(messages, system, anthropicKey);
    } catch (e) {
      lastErr = e;
      const retryable = e && (e.statusCode === 429 || e.statusCode === 529);
      if (!retryable || attempt >= delays.length) throw e;
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('baseRpc timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Parse bounty amount from cast text. Handles:
//   "10 USDC", "10 $USDC", "10 DEGEN", "10 $DEGEN" → {10, 'usdc'/'degen'}
//   "$50"                                            → {50, 'usd'}
//   "164,000 $SKY" (unknown token)                  → {164000, 'unknown'}
// Lookbehind (?<![0-9,]) prevents "000" inside "164,000 $SKY" from matching.
function parseBountyAmount(text) {
  const m =
    // "10 $DEGEN" / "10 $USDC" — digits then $KNOWN_TOKEN
    text.match(/(?<![0-9,])(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*\$(usdc|eth|degen|op)/i) ||
    // "10 DEGEN" / "10 USDC" / "10 USD" — digits then KNOWN_TOKEN (no $)
    text.match(/(?<![0-9,])(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s+(usdc|eth|degen|op|usd)\b/i) ||
    // "$50" — dollar sign then digits (USD implied)
    text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\b/i) ||
    // "164,000 $SKY" — digits before any $TOKEN (unknown token, still record the amount)
    text.match(/(?<![0-9,])(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*\$[A-Z]/i);
  if (!m) return { amount: 0, token: 'unknown' };
  const raw = (m[1] || m[0]).replace(/[^0-9.]/g, '');
  const token = m[2] ? m[2].toLowerCase() : (/^\$/.test(m[0]) ? 'usd' : 'unknown');
  return { amount: parseFloat(raw) || 0, token };
}

// Estimate USD value of bounty (rough, for pre-filtering only)
function estimateUsd(amount, token, ethPriceUsd) {
  if (!amount) return 0;
  if (token === 'usdc' || token === 'usd') return amount;
  if (token === 'eth') return amount * (ethPriceUsd || 2000);
  if (token === 'degen') return amount * 0.003;
  if (token === 'op') return amount * 1.2;
  return amount * 0.001; // unknown token: assume low value, don't filter out
}

// Extract deadline date from bounty text. Returns Date or null.
function parseDeadline(text) {
  const m = text.match(/\b(?:deadline|expir(?:y|es?)|due)[:\s]+(\d{4}-\d{2}-\d{2})/i)
    || text.match(/\b(?:deadline|expir(?:y|es?)|due)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function fetchBounties(apiKey, onEvent) {
  const log = onEvent || (() => {});

  // Neynar Hub API: castsByMention fid=20596 — free tier, Farcaster protocol layer.
  // Returns all casts that mention @bountybot (FID 20596) = the actual bounty posts.
  // Response is protobuf JSON (different schema from Neynar API v2).
  let messages = [];
  try {
    // reverse=1: newest mentions first (hub default is oldest-first, missing recent bounties)
    const data = await hubApiGet('/v1/castsByMention?fid=' + BOUNTYBOT_FID + '&pageSize=200&reverse=true', apiKey);
    messages = data.messages || [];
    log('info', '[BOUNTY] HubAPI: ' + messages.length + ' menciones a @bountybot');
  } catch (e) {
    log('warn', '[BOUNTY] HubAPI falló: ' + e.message);
    return [];
  }

  return messages.filter(msg => {
    if (!msg.data || msg.data.type !== 'MESSAGE_TYPE_CAST_ADD') return false;
    const body = msg.data.castAddBody || {};
    const low = (body.text || '').toLowerCase();
    if (/paid|closed|completed|winner|rewarded/i.test(low)) return false;
    if (/an error occured|couldn'?t find|could not find|no active bounty|not found|try again/i.test(low)) return false;
    return true;
  }).map(msg => {
    const body = msg.data.castAddBody || {};
    const { amount, token } = parseBountyAmount(body.text || '');
    // Farcaster epoch → Unix ms.
    const tsMs = (msg.data.timestamp || 0) * 1000 + FC_EPOCH_MS;
    // Hub HTTP API returns hashes already as '0x<hex>' strings.
    // Handle all three possible formats defensively.
    let hashHex = '';
    if (msg.hash) {
      if (/^0x[0-9a-fA-F]+$/i.test(msg.hash)) {
        hashHex = msg.hash.toLowerCase();          // already correct: 0x<hex>
      } else if (/^[0-9a-fA-F]{20,}$/i.test(msg.hash)) {
        hashHex = '0x' + msg.hash.toLowerCase();   // bare hex without prefix
      } else {
        hashHex = '0x' + Buffer.from(msg.hash, 'base64').toString('hex'); // protobuf base64
      }
    }
    return {
      hash: hashHex,
      authorUsername: 'fid:' + msg.data.fid,
      authorFid: msg.data.fid,
      hasParentAuthor: true,
      text: body.text || '',
      timestamp: new Date(tsMs).toISOString(),
      amount,
      token
    };
  }).filter(b => b.hash && b.hash.length > 4);
}

async function classifyBounty(bounty, anthropicKey) {
  const prompt = `You are evaluating whether an AI text agent can complete this Farcaster bounty.

Bounty text: "${bounty.text}"

The agent CAN do: writing, copywriting, research, summarization, Q&A, translation (EN/ES), content drafting, analysis of provided text, brainstorming, compiling information, blog posts, threads, captions, plans, reports.

The agent CANNOT do: write/run code, create images/video/audio, physical tasks, login to accounts, on-chain actions, "first to achieve X" competitions, anything NSFW or illegal.

CRITICAL RULE — External content: if the task asks the agent to review, proofread, analyze, critique, or improve a specific piece of content (documentation, article, code, draft, website, etc.) that is NOT included inline in the bounty text, return eligible: false with reason "requires external content not provided". The agent cannot access URLs, uploaded files, or content outside this bounty text.

Return ONLY valid JSON (no markdown): {"eligible": true/false, "category": "string", "confidence": 0.0-1.0, "reason": "one sentence", "deliverable_type": "string"}`;

  const text = await claudeChat(
    [{ role: 'user', content: prompt }],
    'You classify bounties for an autonomous AI agent. Return only JSON.',
    anthropicKey
  );
  try {
    const m = (text || '').match(/\{[\s\S]*\}/);
    const clean = m ? m[0] : (text || '').replace(/```[jJ][sS][oO][nN]?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const conf = Number(parsed.confidence);
    parsed.confidence = Number.isFinite(conf) ? conf : 0;
    if (!Number.isFinite(conf)) {
      parsed.eligible = false;
      if (!parsed.reason) parsed.reason = 'invalid confidence';
    }
    return parsed;
  } catch (e) {
    return { eligible: false, confidence: 0, reason: 'parse error', category: 'unknown' };
  }
}

async function generateDeliverable(bounty, anthropicKey) {
  const prompt = `Complete this Farcaster bounty task. Write a high-quality, direct deliverable.

Bounty: "${bounty.text}"

Requirements:
- FIRST: identify every specific constraint in the bounty (exact type, geography, audience, format, exclusions). Your deliverable must satisfy ALL of them — do not substitute, generalize, or include items that partially fit.
- Deliver the actual work, not a description of it
- Be concise but complete (Farcaster replies have a ~1024 char limit, so be efficient)
- If translation EN→ES or ES→EN: provide the full translation
- If research/Q&A: provide the answer directly with verified, specific facts — no padding
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
    const m = (text || '').match(/\{[\s\S]*\}/);
    const clean = m ? m[0] : (text || '').replace(/```[jJ][sS][oO][nN]?|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const sc = Number(parsed.score);
    parsed.score = Number.isFinite(sc) ? sc : 0;
    if (!Number.isFinite(sc)) {
      parsed.issues = (parsed.issues && parsed.issues.length) ? parsed.issues : ['invalid score'];
    }
    return parsed;
  } catch (e) {
    // Fallback: extract score from prose ("score: 9", "9/10", "9 out of 10")
    const nm = (text || '').match(/\bscore["\s:]+(\d+)/i)
      || (text || '').match(/\b(\d+)\s*\/\s*10\b/)
      || (text || '').match(/\b(\d+)\s+out\s+of\s+10\b/i);
    if (nm) return { score: parseInt(nm[1], 10), issues: ['json parse failed'] };
    return { score: 0, issues: ['parse error'] };
  }
}

async function submitBounty(bounty, deliverable, apiKey, signerUuid) {
  // Reply to the bounty cast with the deliverable
  // Farcaster cast limit is 1024 chars
  var text = deliverable || '';
  if (text.length > 1020) {
    var cut = text.slice(0, 1019);
    var lastSpace = cut.search(/\s\S*$/); // index of last whitespace
    if (lastSpace > 200) cut = cut.slice(0, lastSpace); // avoid over-trimming short text
    text = cut.replace(/\s+$/, '') + '…';
  }
  const body = { signer_uuid: signerUuid, text, parent: bounty.hash };
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
    let todaySubmissions = submitted.filter(s => s.date === today).length;

    if (todaySubmissions >= MAX_SUBMISSIONS_PER_DAY) {
      onEvent('info', '[BOUNTY] Límite diario alcanzado (' + MAX_SUBMISSIONS_PER_DAY + '/día)');
      return;
    }

    let bounties;
    try {
      bounties = await fetchBounties(neynarApiKey, onEvent);
      onEvent('info', '[BOUNTY] ' + bounties.length + ' bounties elegibles en Farcaster');
    } catch (e) {
      onEvent('warn', '[BOUNTY] Error fetching bounties: ' + e.message);
      return;
    }

    const ethUsd = getEthPriceUsd();
    let lastSubmitTime = state.lastBountySubmit || 0;
    const stats = { alreadySeen: 0, expired: 0, noAmount: 0, dust: 0, disqualified: 0, candidates: 0 };
    const MAX_CLAUDE_CALLS_PER_SCAN = 20; // avoid API spam; real filter is confidence threshold
    let claudeCalls = 0;

    for (const bounty of bounties) {
      if (todaySubmissions >= MAX_SUBMISSIONS_PER_DAY) break;
      if (seen[bounty.hash]) { stats.alreadySeen++; continue; }
      if (Date.now() - lastSubmitTime < SUBMIT_COOLDOWN_MS) break;

      // NOTE: do NOT mark seen up-front. Mark only after a DEFINITIVE decision
      // (not eligible / low score / submitted) so transient infra errors retry.

      // Pre-filter: skip bounties with expired deadline
      const dl = parseDeadline(bounty.text);
      if (dl && dl < new Date()) { stats.expired++; seen[bounty.hash] = Date.now(); continue; }

      // Pre-filter: discard bounties without a valid parent_author (can't reliably attribute)
      if (!bounty.hasParentAuthor) {
        stats.noAmount++;
        seen[bounty.hash] = Date.now();
        continue;
      }

      // Pre-filter: skip cheap dust or unparseable amounts (token=unknown, amount=0 → meta-message)
      const usdValue = estimateUsd(bounty.amount, bounty.token, ethUsd);
      if (bounty.token === 'unknown' && bounty.amount === 0) { stats.noAmount++; seen[bounty.hash] = Date.now(); continue; }
      if (usdValue < MIN_BOUNTY_VALUE_USD && bounty.amount > 0) {
        stats.dust++;
        seen[bounty.hash] = Date.now();
        continue;
      }

      // Pre-filter: hard disqualifiers (cheap, no Claude call)
      const disqualified = DISQUALIFY_PATTERNS.some(p => p.test(bounty.text));
      if (disqualified) { stats.disqualified++; seen[bounty.hash] = Date.now(); continue; }

      if (claudeCalls >= MAX_CLAUDE_CALLS_PER_SCAN) break;

      stats.candidates++;
      claudeCalls++;
      onEvent('info', '[BOUNTY] Candidato: "' + bounty.text.slice(0, 80) + '" (' + bounty.amount + ' ' + bounty.token + ')');

      // Classify with Claude
      let classification;
      try {
        classification = await classifyBounty(bounty, anthropicKey);
      } catch (e) {
        // Transient infra error — do NOT mark seen, retry next scan
        onEvent('warn', '[BOUNTY] Error clasificando (reintentable): ' + e.message);
        continue;
      }

      const confidence = Number(classification.confidence);
      if (!classification.eligible || !Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
        // Definitive decision: not eligible
        onEvent('info', '[BOUNTY] Skip (' + (classification.reason || 'no eligible') + ')');
        seen[bounty.hash] = Date.now();
        continue;
      }

      onEvent('info', '[BOUNTY] Elegible: ' + classification.category + ' (confianza ' + (classification.confidence * 100).toFixed(0) + '%)');

      // Generate deliverable
      let draft;
      try {
        draft = await generateDeliverable(bounty, anthropicKey);
      } catch (e) {
        // Transient infra error — do NOT mark seen, retry next scan
        onEvent('warn', '[BOUNTY] Error generando entregable (reintentable): ' + e.message);
        continue;
      }

      // Self-critique
      let critique;
      try {
        critique = await critiqueDeliverable(bounty, draft, anthropicKey);
      } catch (e) {
        // Transient infra error — do NOT mark seen, retry next scan
        onEvent('warn', '[BOUNTY] Error en auto-revisión (reintentable): ' + e.message);
        continue;
      }

      const score = Number(critique.score);
      onEvent('info', '[BOUNTY] Auto-score: ' + critique.score + '/10' + (critique.issues && critique.issues.length ? ' — ' + critique.issues[0] : ''));

      if (!Number.isFinite(score) || score < MIN_SELF_SCORE) {
        // Definitive decision: insufficient quality
        onEvent('info', '[BOUNTY] Score insuficiente (' + critique.score + '<' + MIN_SELF_SCORE + '), descartando');
        seen[bounty.hash] = Date.now();
        continue;
      }

      if (dryRun) {
        onEvent('info', '[BOUNTY] DRY-RUN — NO posteado (score ' + critique.score + '/10, ' + bounty.amount + ' ' + bounty.token + ')');
        onEvent('info', '[BOUNTY] Entregable: ' + draft.slice(0, 200));
        seen[bounty.hash] = Date.now();
        const s = getState();
        s.bountiesSeen = purgeSeen(seen);
        saveState(s);
        continue;
      }

      // Submit
      try {
        await submitBounty(bounty, draft, neynarApiKey, signerUuid);
        seen[bounty.hash] = Date.now(); // definitive: submitted successfully
        todaySubmissions++; // for local guard
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
        s.bountiesSeen = purgeSeen(seen);
        s.bountiesSubmitted = submitted.slice(-200);
        s.lastBountySubmit = Date.now();
        saveState(s);
      } catch (e) {
        // Transient infra error on submit — do NOT mark seen, retry next scan
        onEvent('warn', '[BOUNTY] Error enviando (reintentable): ' + e.message);
      }
    }

    // Log filter breakdown so we can tune thresholds
    onEvent('info', '[BOUNTY] Filtros → vistos:' + stats.alreadySeen + ' vencidos:' + stats.expired + ' sinMonto:' + stats.noAmount + ' polvo:' + stats.dust + ' desc:' + stats.disqualified + ' candidatos:' + stats.candidates);

    // Save seen state (purged of stale entries)
    const s = getState();
    s.bountiesSeen = purgeSeen(seen);
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
