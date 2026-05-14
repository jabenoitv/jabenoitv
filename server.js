const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const w = path.join(os.homedir(), '.workclaw');
const m = path.join(os.homedir(), '.moltlaunch');
fs.mkdirSync(w, { recursive: true });
fs.mkdirSync(m, { recursive: true });

fs.writeFileSync(path.join(w, 'workclaw.json'), JSON.stringify({
  polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
  pricing: { strategy: 'fixed', baseRateEth: '0.005', maxRateEth: '0.05' },
  specialties: [
    'writing', 'copywriting', 'content-creation', 'blog-writing',
    'email-writing', 'social-media-content', 'product-descriptions',
    'technical-writing', 'creative-writing', 'proofreading', 'editing',
    'research', 'web-research', 'market-research', 'competitive-analysis',
    'data-analysis', 'summarization', 'fact-checking',
    'coding', 'programming', 'debugging', 'code-review',
    'documentation', 'api-documentation',
    'business-writing', 'report-writing', 'seo-content', 'customer-support-templates',
    'translation', 'language-editing',
    'web-scraping', 'data-extraction', 'website-analysis',
    'question-answering', 'brainstorming', 'planning', 'consulting'
  ],
  autoQuote: true,
  autoWork: true,
  maxConcurrentTasks: 3,
  declineKeywords: ['image-generation', 'video-creation', 'audio-generation', 'music-creation', 'nsfw', 'illegal'],
  agentId: process.env.AGENT_ID || '',
  llm: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: 'claude-sonnet-4-20250514'
  }
}, null, 2));

fs.writeFileSync(path.join(m, 'wallet.json'), JSON.stringify({
  address: process.env.WALLET_ADDRESS || '',
  privateKey: process.env.WALLET_PRIVATE_KEY || ''
}, null, 2));

console.log('Config ready. AgentId:', process.env.AGENT_ID);

const PORT = Number(process.env.PORT || 3777);
const CASHCLAW_PORT = PORT + 1;

const cashclawDist = path.join(process.cwd(), 'node_modules', 'cashclaw-agent', 'dist', 'index.js');
try {
  let src = fs.readFileSync(cashclawDist, 'utf8');
  if (src.includes('var PORT = 3777')) {
    src = src.replace('var PORT = 3777;', 'var PORT = ' + CASHCLAW_PORT + ';');
    src = src.replace(/localhost:3777/g, 'localhost:' + CASHCLAW_PORT);
    fs.writeFileSync(cashclawDist, src);
    console.log('Cashclaw parcheado: usará puerto ' + CASHCLAW_PORT);
  }
} catch (e) {
  console.log('No se pudo parchear cashclaw:', e.message);
}

let ethPrice = { usd: 0, clp: 0, updatedAt: null };

function fetchEthPrice() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,clp';
  https.get(url, { headers: { 'User-Agent': 'cashclaw-dashboard/1.0' } }, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (d.ethereum) {
          ethPrice = { usd: d.ethereum.usd, clp: d.ethereum.clp, updatedAt: new Date().toISOString() };
          console.log('Precio ETH: $' + ethPrice.usd + ' USD');
        }
      } catch (e) { console.log('Error precio ETH:', e.message); }
    });
  }).on('error', e => { console.log('No se pudo obtener precio ETH:', e.message); });
}

fetchEthPrice();
setInterval(fetchEthPrice, 5 * 60 * 1000);

const logs = [];
const MAX_LOGS = 500;
const jobs = [];
const MAX_JOBS = 100;
let totalEarnedEth = 0;
let completedJobsCount = 0;
let lastActivity = null;
let cashclawProc = null;
let cashclawStatus = 'starting';
let restartCount = 0;

function detectJobEvent(line, time) {
  if (/task.*receiv|receiv.*task|new.*task|job.*receiv|receiv.*job|assigned|accept.*offer|offer.*accept|new.*job/i.test(line)) {
    const dm = line.match(/["']([^"']{8,80})["']/) || line.match(/task[:\s]+(.{8,60})/i);
    jobs.unshift({
      id: Date.now(), startTime: time, completedTime: null, status: 'activo',
      description: dm ? dm[1].trim() : line.trim().slice(0, 80), earnedEth: null
    });
    if (jobs.length > MAX_JOBS) jobs.pop();
  }
  if (/complet|finish|done.*task|task.*done|submit|deliver/i.test(line)) {
    const active = jobs.find(j => j.status === 'activo');
    if (active) { active.status = 'completado'; active.completedTime = time; completedJobsCount++; }
  }
  const ethMatch = line.match(/([0-9]+\.[0-9]+)\s*ETH/i);
  if (ethMatch && /earn|pay|receiv|reward|profit|transfer|sent/i.test(line)) {
    const eth = parseFloat(ethMatch[1]);
    if (eth > 0) {
      totalEarnedEth = Math.round((totalEarnedEth + eth) * 1e8) / 1e8;
      const j = jobs.find(j => j.status === 'completado' && !j.earnedEth);
      if (j) { j.earnedEth = eth; j.status = 'pagado'; }
    }
  }
}

function addLog(line, type) {
  const entry = { time: new Date().toISOString(), msg: line.trim(), type };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  lastActivity = entry.time;
  detectJobEvent(line, entry.time);
}

const binPath = path.join(process.cwd(), 'node_modules', '.bin', 'cashclaw');
const bin = fs.existsSync(binPath) ? binPath : 'cashclaw';

function startCashclaw() {
  cashclawStatus = 'running';
  cashclawProc = spawn(bin, [], { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  cashclawProc.stdout.on('data', d =>
    d.toString().split('\n').filter(l => l.trim()).forEach(l => { process.stdout.write(l + '\n'); addLog(l, 'info'); })
  );
  cashclawProc.stderr.on('data', d =>
    d.toString().split('\n').filter(l => l.trim()).forEach(l => { process.stderr.write(l + '\n'); addLog(l, 'error'); })
  );
  cashclawProc.on('exit', code => {
    restartCount++;
    const msg = 'CashClaw salió (código ' + code + ') — reiniciando en 15s (#' + restartCount + ')';
    console.log(msg); addLog(msg, 'warn');
    cashclawStatus = 'restarting';
    setTimeout(startCashclaw, 15000);
  });
}

const startTime = Date.now();

function buildHTML() {
  return '<!DOCTYPE html>\n<html lang="es">\n<head>\n' +
  '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n' +
  '<title>CashClaw · Agente ' + (process.env.AGENT_ID || '51049') + '</title>\n' +
  '<style>\n' +
  '*{box-sizing:border-box;margin:0;padding:0}\n' +
  'body{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}\n' +
  'header{background:#1e293b;padding:18px 24px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}\n' +
  'header h1{font-size:1.2em;color:#38bdf8}\n' +
  'header p{color:#94a3b8;font-size:.8em}\n' +
  '.earn-banner{background:linear-gradient(135deg,#052e16,#0a3d1f);border-bottom:1px solid #166534;padding:20px 24px;text-align:center}\n' +
  '.earn-banner .label{font-size:.72em;color:#86efac;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}\n' +
  '.earn-eth{font-size:2.2em;font-weight:800;color:#4ade80;font-family:monospace;letter-spacing:1px}\n' +
  '.earn-fiat{display:flex;justify-content:center;gap:24px;margin-top:8px;flex-wrap:wrap}\n' +
  '.earn-fiat span{font-size:1.1em;font-weight:600;color:#bbf7d0}\n' +
  '.earn-fiat .sep{color:#166534;font-weight:400}\n' +
  '.earn-ts{font-size:.72em;color:#4ade80;opacity:.6;margin-top:6px}\n' +
  '.cards{display:flex;gap:12px;padding:16px 24px 0;flex-wrap:wrap}\n' +
  '.card{background:#1e293b;border-radius:10px;padding:14px 18px;flex:1;min-width:130px;border:1px solid #334155}\n' +
  '.card label{font-size:.68em;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}\n' +
  '.card .val{font-size:1.25em;font-weight:700;margin-top:5px;color:#f1f5f9}\n' +
  '.card .val.mono{font-size:.82em;font-family:monospace;color:#94a3b8}\n' +
  '.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#22c55e;margin-right:7px;animation:pulse 2s infinite}\n' +
  '.dot.warn{background:#f59e0b}.dot.off{background:#ef4444}\n' +
  '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}\n' +
  '.tags{padding:12px 24px;display:flex;flex-wrap:wrap;gap:7px}\n' +
  '.tag{background:#0f3460;color:#38bdf8;border:1px solid #1e4d8c;border-radius:20px;padding:3px 10px;font-size:.72em}\n' +
  '.section{margin:14px 24px 0;background:#1e293b;border-radius:10px;border:1px solid #334155;overflow:hidden}\n' +
  '.section-hdr{padding:12px 18px;border-bottom:1px solid #334155;font-size:.8em;color:#94a3b8;display:flex;justify-content:space-between;align-items:center}\n' +
  '.log{padding:6px 18px;border-bottom:1px solid #162032;font-family:monospace;font-size:.78em;display:flex;gap:12px;line-height:1.5}\n' +
  '.log:last-child{border-bottom:none}\n' +
  '.log .t{color:#475569;white-space:nowrap;flex-shrink:0}\n' +
  '.log .msg{color:#cbd5e1;word-break:break-all}\n' +
  '.log.error .msg{color:#fca5a5}.log.warn .msg{color:#fbbf24}\n' +
  '.job-row{padding:10px 18px;border-bottom:1px solid #162032;display:flex;gap:10px;align-items:flex-start;font-size:.8em}\n' +
  '.job-row:last-child{border-bottom:none}\n' +
  '.badge{padding:2px 9px;border-radius:10px;font-size:.7em;font-weight:700;white-space:nowrap;flex-shrink:0;margin-top:1px}\n' +
  '.badge.activo{background:#422006;color:#fbbf24;border:1px solid #92400e}\n' +
  '.badge.completado{background:#0c1a2e;color:#60a5fa;border:1px solid #1d4ed8}\n' +
  '.badge.pagado{background:#052e16;color:#4ade80;border:1px solid #166534}\n' +
  '.job-body{flex:1;min-width:0}\n' +
  '.job-desc{color:#cbd5e1;word-break:break-word}\n' +
  '.job-meta{font-size:.72em;color:#475569;margin-top:2px}\n' +
  '.job-earn{color:#4ade80;font-weight:700;white-space:nowrap;font-family:monospace;flex-shrink:0;font-size:.82em;margin-top:1px}\n' +
  '.empty{padding:32px;text-align:center;color:#475569;font-size:.88em}\n' +
  '.footer{text-align:center;padding:14px;color:#475569;font-size:.75em;margin-top:14px}\n' +
  '.footer a{color:#38bdf8;text-decoration:none}\n' +
  '</style></head><body>\n' +
  '<header>\n' +
  '  <div><h1>⚡ CashClaw</h1><p>Agente · ID #' + (process.env.AGENT_ID || '51049') + ' · Moltlaunch</p></div>\n' +
  '  <div id="hdr-status" style="font-size:.8em;color:#94a3b8">...</div>\n' +
  '</header>\n' +
  '<div class="earn-banner">\n' +
  '  <div class="label">⭐ Ganancias totales</div>\n' +
  '  <div class="earn-eth" id="earn-eth">0.000000 ETH</div>\n' +
  '  <div class="earn-fiat">\n' +
  '    <span id="earn-usd">$ 0.00 USD</span>\n' +
  '    <span class="sep">|</span>\n' +
  '    <span id="earn-clp">$ 0 CLP</span>\n' +
  '  </div>\n' +
  '  <div class="earn-ts" id="earn-ts">actualizando cada 15 seg</div>\n' +
  '</div>\n' +
  '<div class="cards">\n' +
  '  <div class="card"><label>Estado</label><div class="val" id="st"><span class="dot"></span>...</div></div>\n' +
  '  <div class="card"><label>Tiempo activo</label><div class="val" id="up">-</div></div>\n' +
  '  <div class="card"><label>Trabajos</label><div class="val" id="jobs-badge">0</div></div>\n' +
  '  <div class="card"><label>Wallet</label><div class="val mono" id="wal">-</div></div>\n' +
  '</div>\n' +
  '<div class="tags">\n' +
  '  <span class="tag">writing</span><span class="tag">copywriting</span><span class="tag">research</span>\n' +
  '  <span class="tag">coding</span><span class="tag">data-analysis</span><span class="tag">translation</span>\n' +
  '  <span class="tag">brainstorming</span><span class="tag">consulting</span><span class="tag">+28 más</span>\n' +
  '</div>\n' +
  '<div class="section">\n' +
  '  <div class="section-hdr"><span>📋 Registro de Trabajos</span><span id="jobs-cnt" style="color:#64748b">-</span></div>\n' +
  '  <div id="jobs-list"><div class="empty">Esperando primer trabajo del marketplace...</div></div>\n' +
  '</div>\n' +
  '<div class="section">\n' +
  '  <div class="section-hdr"><span>📡 Actividad reciente</span><span id="log-cnt" style="color:#64748b">-</span></div>\n' +
  '  <div id="log-list"><div class="empty">Cargando...</div></div>\n' +
  '</div>\n' +
  '<div class="footer">Actualización cada 15 seg · <a href="/">Refrescar</a></div>\n' +
  '<script>\n' +
  'function fmt(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return h?h+\'h \'+m+\'m\':m?m+\'m \'+sec+\'s\':sec+\'s\'}\n' +
  'function ftime(iso){return new Date(iso).toLocaleTimeString(\'es\',{hour:\'2-digit\',minute:\'2-digit\',second:\'2-digit\'})}\n' +
  'function fdate(iso){var d=new Date(iso);return d.toLocaleDateString(\'es-CL\',{day:\'2-digit\',month:\'2-digit\'})+\' \'+ftime(iso)}\n' +
  'function fdur(a,b){if(!b)return \'activo\';var mins=Math.round((new Date(b)-new Date(a))/60000);return mins<1?\'<1 min\':mins+\'min\'}\n' +
  'var dotC={running:\'dot\',restarting:\'dot warn\',starting:\'dot warn\',stopped:\'dot off\'};\n' +
  'var dotCol={running:\'#4ade80\',restarting:\'#fbbf24\',starting:\'#94a3b8\',stopped:\'#f87171\'};\n' +
  'var ethUsd=0,ethClp=0;\n' +
  'function fmtNum(n,dec){return n.toLocaleString(\'en-US\',{minimumFractionDigits:dec,maximumFractionDigits:dec})}\n' +
  'function fmtClp(n){return Math.round(n).toLocaleString(\'es-CL\')}\n' +
  'function ethLine(eth){\n' +
  '  if(!eth||eth<=0)return \'\';\n' +
  '  var s=eth+\' ETH\';\n' +
  '  if(ethUsd)s+=\' = $\'+fmtNum(eth*ethUsd,2)+\' USD / $\'+fmtClp(eth*ethClp)+\' CLP\';\n' +
  '  return s;\n' +
  '}\n' +
  'async function load(){\n' +
  '  try{\n' +
  '    var res=await Promise.all([\n' +
  '      fetch(\'/api/status\').then(function(r){return r.json();}),\n' +
  '      fetch(\'/api/logs\').then(function(r){return r.json();}),\n' +
  '      fetch(\'/api/jobs\').then(function(r){return r.json();}),\n' +
  '      fetch(\'/api/price\').then(function(r){return r.json();})\n' +
  '    ]);\n' +
  '    var st=res[0],ls=res[1],jd=res[2],pr=res[3];\n' +
  '    if(pr.usd>0){ethUsd=pr.usd;ethClp=pr.clp;}\n' +
  '    var te=jd.totalEarned||0;\n' +
  '    document.getElementById(\'earn-eth\').textContent=(te>0?te.toFixed(6):\'0.000000\')+\' ETH\';\n' +
  '    document.getElementById(\'earn-usd\').textContent=\'$ \'+(ethUsd?fmtNum(te*ethUsd,2):\'0.00\')+\' USD\';\n' +
  '    document.getElementById(\'earn-clp\').textContent=\'$ \'+(ethClp?fmtClp(te*ethClp):\'0\')+\' CLP\';\n' +
  '    document.getElementById(\'earn-ts\').textContent=\'actualizado \'+ftime(new Date().toISOString())+(ethUsd?\' · 1 ETH = $\'+fmtNum(ethUsd,0)+\' USD\':\'\');\n' +
  '    document.getElementById(\'st\').innerHTML=\'<span class="\'+( dotC[st.status]||\' dot\')+\'"></span>\'+st.status;\n' +
  '    document.getElementById(\'hdr-status\').innerHTML=\'<span class="\'+( dotC[st.status]||\' dot\')+\'"></span>\'+st.status+\' · \'+fmt(st.uptime);\n' +
  '    document.getElementById(\'up\').textContent=fmt(st.uptime);\n' +
  '    document.getElementById(\'wal\').textContent=st.wallet?st.wallet.slice(0,6)+\'...\'+st.wallet.slice(-4):\'-\';\n' +
  '    var jobs=jd.jobs||[];\n' +
  '    document.getElementById(\'jobs-badge\').textContent=(jd.completed||0)+\' completados\';\n' +
  '    document.getElementById(\'jobs-cnt\').textContent=jobs.length?(jd.completed||0)+\' completados · \'+jobs.length+\' total\':\'Sin trabajos aún\';\n' +
  '    var jel=document.getElementById(\'jobs-list\');\n' +
  '    jel.innerHTML=jobs.length?jobs.map(function(j){\n' +
  '      var earnStr=j.earnedEth?\'<div class="job-earn">\'+ethLine(j.earnedEth)+\'</div>\':\'\';\n' +
  '      return \'<div class="job-row"><span class="badge \'+j.status+\'">\'+j.status+\'</span>\'+\n' +
  '        \'<div class="job-body"><div class="job-desc">\'+j.description.replace(/</g,\'&lt;\')+\'</div>\'+\n' +
  '        \'<div class="job-meta">\'+fdate(j.startTime)+\' · \'+fdur(j.startTime,j.completedTime)+\'</div></div>\'+earnStr+\'</div>\';\n' +
  '    }).join(\'\'):\'<div class="empty">Esperando primer trabajo del marketplace...</div>\';\n' +
  '    document.getElementById(\'log-cnt\').textContent=ls.length+\' eventos\';\n' +
  '    var el=document.getElementById(\'log-list\');\n' +
  '    el.innerHTML=ls.length?[].concat(ls).reverse().map(function(l){\n' +
  '      var msg=l.msg.replace(/</g,\'&lt;\');\n' +
  '      var em=msg.match(/([0-9.]+)\\s*ETH/);\n' +
  '      if(em&&ethUsd){var eth=parseFloat(em[1]);msg+=\' <span style="color:#4ade80;font-weight:bold">($\'+fmtNum(eth*ethUsd,2)+\' USD / $\'+fmtClp(eth*ethClp)+\' CLP)</span>\';}\n' +
  '      return \'<div class="log \'+( l.type||\' \')+\'"><span class="t">\'+ftime(l.time)+\'</span><span class="msg">\'+msg+\'</span></div>\';\n' +
  '    }).join(\'\'):\'<div class="empty">Sin actividad aún</div>\';\n' +
  '  }catch(e){}\n' +
  '}\n' +
  'load();setInterval(load,15000);\n' +
  '<\/script></body></html>';
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      agent: process.env.AGENT_ID, wallet: process.env.WALLET_ADDRESS,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      status: cashclawStatus, lastActivity,
      completedJobs: completedJobsCount, totalEarned: totalEarnedEth, restarts: restartCount
    }));
  }
  if (url === '/api/price') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(ethPrice));
  }
  if (url === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(logs));
  }
  if (url === '/api/jobs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ jobs, totalEarned: totalEarnedEth, completed: completedJobsCount, count: jobs.length }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(buildHTML());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard listo en http://0.0.0.0:' + PORT);
  startCashclaw();
});

server.on('error', err => {
  console.error('Error servidor:', err.message);
  process.exit(1);
});
