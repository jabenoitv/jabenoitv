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
    src = src.replace('var PORT = 3777;', `var PORT = ${CASHCLAW_PORT};`);
    src = src.replace(/localhost:3777/g, `localhost:${CASHCLAW_PORT}`);
    fs.writeFileSync(cashclawDist, src);
    console.log(`Cashclaw parcheado: usará puerto ${CASHCLAW_PORT}`);
  }
} catch (e) {
  console.log('No se pudo parchear cashclaw:', e.message);
}

let ethPrice = { usd: 0, clp: 0, updatedAt: null };

function fetchEthPrice() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,clp';
  https.get(url, { headers: { 'User-Agent': 'cashclaw-dashboard/1.0' } }, res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (d.ethereum) {
          ethPrice = { usd: d.ethereum.usd, clp: d.ethereum.clp, updatedAt: new Date().toISOString() };
          console.log(`Precio ETH: $${ethPrice.usd} USD`);
        }
      } catch (e) { console.log('Error precio ETH:', e.message); }
    });
  }).on('error', e => console.log('No se pudo obtener precio ETH:', e.message));
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
      id: Date.now(),
      startTime: time,
      completedTime: null,
      status: 'activo',
      description: dm ? dm[1].trim() : line.trim().slice(0, 80),
      earnedEth: null
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
  cashclawProc.on('exit', (code) => {
    restartCount++;
    const msg = 'CashClaw salió (código ' + code + ') — reiniciando en 15s (#' + restartCount + ')';
    console.log(msg); addLog(msg, 'warn');
    cashclawStatus = 'restarting';
    setTimeout(startCashclaw, 15000);
  });
}

const startTime = Date.now();

const DASHBOARD_HTML = '<!DOCTYPE html>\n' +
'<html lang="es">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'  <title>CashClaw · Agente ' + (process.env.AGENT_ID || '51049') + '</title>\n' +
'  <style>\n' +
'    *{box-sizing:border-box;margin:0;padding:0}\n' +
'    body{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}\n' +
'    header{background:#1e293b;padding:20px 24px;border-bottom:1px solid #334155}\n' +
'    header h1{font-size:1.3em;color:#38bdf8}header p{color:#94a3b8;font-size:.82em;margin-top:3px}\n' +
'    .cards{display:flex;gap:14px;padding:20px 24px 0;flex-wrap:wrap}\n' +
'    .card{background:#1e293b;border-radius:12px;padding:18px 20px;flex:1;min-width:150px;border:1px solid #334155}\n' +
'    .card label{font-size:.72em;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}\n' +
'    .card .val{font-size:1.4em;font-weight:700;margin-top:6px;color:#f1f5f9}\n' +
'    .card .val.small{font-size:1em}\n' +
'    .card .val.mono{font-size:.85em;font-family:monospace;color:#94a3b8}\n' +
'    .card .sub{font-size:.75em;color:#64748b;margin-top:3px}\n' +
'    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;margin-right:8px;animation:pulse 2s infinite}\n' +
'    .dot.warn{background:#f59e0b}.dot.off{background:#ef4444}\n' +
'    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}\n' +
'    .tags{padding:16px 24px;display:flex;flex-wrap:wrap;gap:8px}\n' +
'    .tag{background:#0f3460;color:#38bdf8;border:1px solid #1e4d8c;border-radius:20px;padding:4px 12px;font-size:.75em}\n' +
'    .section{margin:16px 24px 0;background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden}\n' +
'    .section-hdr{padding:14px 20px;border-bottom:1px solid #334155;font-size:.82em;color:#94a3b8;display:flex;justify-content:space-between;align-items:center}\n' +
'    .conv-wrap{padding:20px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}\n' +
'    .conv-input{background:#0f172a;border:1px solid #475569;color:#f1f5f9;border-radius:8px;padding:10px 14px;font-size:1.1em;width:170px;outline:none;transition:border .2s}\n' +
'    .conv-input:focus{border-color:#38bdf8}\n' +
'    .conv-eq{color:#475569;font-size:1em}\n' +
'    .conv-result{display:flex;flex-direction:column;gap:4px}\n' +
'    .conv-usd{color:#f1f5f9;font-size:1.2em;font-weight:700}\n' +
'    .conv-clp{color:#94a3b8;font-size:.9em}\n' +
'    .conv-hint{color:#475569;font-size:.75em;margin-top:6px}\n' +
'    .log{padding:7px 20px;border-bottom:1px solid #162032;font-family:monospace;font-size:.8em;display:flex;gap:14px;line-height:1.5}\n' +
'    .log:last-child{border-bottom:none}\n' +
'    .log .t{color:#475569;white-space:nowrap;flex-shrink:0}\n' +
'    .log .msg{color:#cbd5e1;word-break:break-all}\n' +
'    .log.error .msg{color:#fca5a5}.log.warn .msg{color:#fbbf24}\n' +
'    .job-row{padding:12px 20px;border-bottom:1px solid #162032;display:flex;gap:12px;align-items:flex-start;font-size:.82em}\n' +
'    .job-row:last-child{border-bottom:none}\n' +
'    .badge{padding:3px 10px;border-radius:12px;font-size:.72em;font-weight:700;white-space:nowrap;flex-shrink:0;margin-top:2px}\n' +
'    .badge.activo{background:#422006;color:#fbbf24;border:1px solid #92400e}\n' +
'    .badge.completado{background:#0c1a2e;color:#60a5fa;border:1px solid #1d4ed8}\n' +
'    .badge.pagado{background:#052e16;color:#4ade80;border:1px solid #166534}\n' +
'    .job-body{flex:1;min-width:0}\n' +
'    .job-desc{color:#cbd5e1;word-break:break-word}\n' +
'    .job-meta{font-size:.75em;color:#475569;margin-top:3px}\n' +
'    .job-earn{color:#4ade80;font-weight:700;white-space:nowrap;font-family:monospace;flex-shrink:0;font-size:.85em;margin-top:2px}\n' +
'    .empty{padding:40px;text-align:center;color:#475569;font-size:.9em}\n' +
'    .footer{text-align:center;padding:16px;color:#475569;font-size:.78em;margin-top:16px}\n' +
'    .footer a{color:#38bdf8;text-decoration:none}\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <header>\n' +
'    <h1>⚡ CashClaw Dashboard</h1>\n' +
'    <p>Agente autónomo · Moltlaunch Marketplace · ID #' + (process.env.AGENT_ID || '51049') + '</p>\n' +
'  </header>\n' +
'  <div class="cards">\n' +
'    <div class="card"><label>Estado</label><div class="val" id="st"><span class="dot"></span>...</div></div>\n' +
'    <div class="card"><label>Tiempo activo</label><div class="val" id="up">-</div></div>\n' +
'    <div class="card"><label>Wallet</label><div class="val mono" id="wal">-</div></div>\n' +
'    <div class="card"><label>Total ganado</label><div class="val small" id="total-eth" style="color:#4ade80">0 ETH</div><div class="sub" id="total-usd">esperando pagos...</div></div>\n' +
'  </div>\n' +
'  <div class="section" style="margin-top:20px">\n' +
'    <div class="section-hdr">\n' +
'      <span>💱 Convertidor ETH</span>\n' +
'      <span id="price-ts" style="color:#475569;font-size:.78em">cargando precio...</span>\n' +
'    </div>\n' +
'    <div class="conv-wrap">\n' +
'      <input class="conv-input" type="number" id="eth-input" placeholder="0.005" step="0.001" min="0">\n' +
'      <span class="conv-eq">ETH =</span>\n' +
'      <div class="conv-result">\n' +
'        <span class="conv-usd" id="conv-usd">escribe una cantidad</span>\n' +
'        <span class="conv-clp" id="conv-clp"></span>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div style="padding:0 24px 16px"><span class="conv-hint" id="conv-hint"></span></div>\n' +
'  </div>\n' +
'  <div class="tags">\n' +
'    <span class="tag">writing</span><span class="tag">copywriting</span><span class="tag">blog-writing</span>\n' +
'    <span class="tag">email-writing</span><span class="tag">social-media-content</span>\n' +
'    <span class="tag">research</span><span class="tag">web-research</span><span class="tag">data-analysis</span>\n' +
'    <span class="tag">coding</span><span class="tag">debugging</span><span class="tag">translation</span>\n' +
'    <span class="tag">brainstorming</span><span class="tag">consulting</span><span class="tag">+23 más</span>\n' +
'  </div>\n' +
'  <div class="section">\n' +
'    <div class="section-hdr">\n' +
'      <span>📋 Registro de Trabajos</span>\n' +
'      <span id="jobs-cnt" style="color:#64748b">Sin trabajos aún</span>\n' +
'    </div>\n' +
'    <div id="jobs-list"><div class="empty">Esperando primer trabajo del marketplace...</div></div>\n' +
'  </div>\n' +
'  <div class="section">\n' +
'    <div class="section-hdr">\n' +
'      <span>📡 Actividad reciente</span>\n' +
'      <span id="log-cnt" style="color:#64748b">-</span>\n' +
'    </div>\n' +
'    <div id="log-list"><div class="empty">Cargando...</div></div>\n' +
'  </div>\n' +
'  <div class="footer">Actualización cada 15 seg · <a href="/">Actualizar ahora</a> · Precio ETH cada 5 min</div>\n' +
'  <script>\n' +
'    function fmt(s){const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return h?h+\'h \'+m+\'m\':m?m+\'m \'+sec+\'s\':sec+\'s\'}\n' +
'    function ftime(iso){return new Date(iso).toLocaleTimeString(\'es\',{hour:\'2-digit\',minute:\'2-digit\',second:\'2-digit\'})}\n' +
'    function fdate(iso){const d=new Date(iso);return d.toLocaleDateString(\'es-CL\',{day:\'2-digit\',month:\'2-digit\'})+\' \'+ftime(iso)}\n' +
'    function fdur(a,b){if(!b)return \'activo\';const mins=Math.round((new Date(b)-new Date(a))/60000);return mins<1?\'<1 min\':mins+\'min\'}\n' +
'    const dotClass={running:\'dot\',restarting:\'dot warn\',starting:\'dot warn\',stopped:\'dot off\'};\n' +
'    const colors={running:\'#4ade80\',restarting:\'#fbbf24\',starting:\'#94a3b8\',stopped:\'#f87171\'};\n' +
'    let ethUsd=0,ethClp=0;\n' +
'    function recalcConv(){\n' +
'      const val=parseFloat(document.getElementById(\'eth-input\').value);\n' +
'      if(!ethUsd){document.getElementById(\'conv-usd\').textContent=\'cargando precio...\';return;}\n' +
'      if(isNaN(val)||val<0){\n' +
'        document.getElementById(\'conv-usd\').textContent=\'escribe una cantidad\';\n' +
'        document.getElementById(\'conv-clp\').textContent=\'\';\n' +
'        document.getElementById(\'conv-hint\').textContent=\'1 ETH = $\'+ethUsd.toLocaleString(\'en-US\',{maximumFractionDigits:0})+\' USD\';\n' +
'        return;\n' +
'      }\n' +
'      document.getElementById(\'conv-usd\').textContent=\'$\'+(val*ethUsd).toLocaleString(\'en-US\',{minimumFractionDigits:2,maximumFractionDigits:2})+\' USD\';\n' +
'      document.getElementById(\'conv-clp\').textContent=\'$\'+Math.round(val*ethClp).toLocaleString(\'es-CL\')+\' CLP\';\n' +
'      document.getElementById(\'conv-hint\').textContent=\'1 ETH = $\'+ethUsd.toLocaleString(\'en-US\',{maximumFractionDigits:0})+\' USD / $\'+ethClp.toLocaleString(\'es-CL\',{maximumFractionDigits:0})+\' CLP\';\n' +
'    }\n' +
'    document.getElementById(\'eth-input\').addEventListener(\'input\', recalcConv);\n' +
'    function ethLine(eth){\n' +
'      if(!eth||eth<=0)return \'\';\n' +
'      var s=eth+\' ETH\';\n' +
'      if(ethUsd) s+=\' = $\'+(eth*ethUsd).toFixed(2)+\' USD / $\'+Math.round(eth*ethClp).toLocaleString(\'es-CL\')+\' CLP\';\n' +
'      return s;\n' +
'    }\n' +
'    async function load(){\n' +
'      try{\n' +
'        const [st,ls,jd,pr]=await Promise.all([\n' +
'          fetch(\'/api/status\').then(r=>r.json()),\n' +
'          fetch(\'/api/logs\').then(r=>r.json()),\n' +
'          fetch(\'/api/jobs\').then(r=>r.json()),\n' +
'          fetch(\'/api/price\').then(r=>r.json())\n' +
'        ]);\n' +
'        if(pr.usd>0){\n' +
'          const prev=ethUsd;\n' +
'          ethUsd=pr.usd; ethClp=pr.clp;\n' +
'          document.getElementById(\'price-ts\').textContent=\'1 ETH = $\'+pr.usd.toLocaleString(\'en-US\',{maximumFractionDigits:0})+\' USD · actualizado \'+ftime(pr.updatedAt);\n' +
'          if(prev!==ethUsd) recalcConv();\n' +
'        }\n' +
'        document.getElementById(\'st\').innerHTML=\'<span class="\'+( dotClass[st.status]||\' dot\')+\'"></span><span style="color:\'+( colors[st.status]||\' #fff\')+\'">\'+ st.status+\'</span>\';\n' +
'        document.getElementById(\'up\').textContent=fmt(st.uptime);\n' +
'        document.getElementById(\'wal\').textContent=st.wallet?st.wallet.slice(0,6)+\'...\'+st.wallet.slice(-4):\'-\';\n' +
'        const te=jd.totalEarned||0;\n' +
'        document.getElementById(\'total-eth\').textContent=te>0?te.toFixed(6)+\' ETH\':\'0 ETH\';\n' +
'        if(ethUsd&&te>0) document.getElementById(\'total-usd\').textContent=\'$\'+(te*ethUsd).toFixed(2)+\' USD / $\'+Math.round(te*ethClp).toLocaleString(\'es-CL\')+\' CLP\';\n' +
'        const jobs=jd.jobs||[];\n' +
'        document.getElementById(\'jobs-cnt\').textContent=jobs.length?(jd.completed||0)+\' completados · \'+jobs.length+\' total\':\'Sin trabajos aún\';\n' +
'        const jel=document.getElementById(\'jobs-list\');\n' +
'        jel.innerHTML=jobs.length?jobs.map(function(j){\n' +
'          var earnStr=j.earnedEth?\'<div class="job-earn">\'+ethLine(j.earnedEth)+\'</div>\':\'\';\n' +
'          return \'<div class="job-row">\'+\n' +
'            \'<span class="badge \'+j.status+\'">\'+ j.status+\'</span>\'+\n' +
'            \'<div class="job-body"><div class="job-desc">\'+j.description.replace(/</g,\'&lt;\')+\'</div>\'+\n' +
'            \'<div class="job-meta">\'+fdate(j.startTime)+\' · \'+fdur(j.startTime,j.completedTime)+\'</div></div>\'+\n' +
'            earnStr+\'</div>\';\n' +
'        }).join(\'\'):\'<div class="empty">Esperando primer trabajo del marketplace...</div>\';\n' +
'        document.getElementById(\'log-cnt\').textContent=ls.length+\' eventos\';\n' +
'        const el=document.getElementById(\'log-list\');\n' +
'        el.innerHTML=ls.length?[...ls].reverse().map(function(l){\n' +
'          var msg=l.msg.replace(/</g,\'&lt;\');\n' +
'          var em=msg.match(/([0-9.]+)\\s*ETH/);\n' +
'          if(em&&ethUsd){var eth=parseFloat(em[1]);msg+=\' <span style="color:#4ade80;font-weight:bold">($\'+( eth*ethUsd).toFixed(2)+\' USD / $\'+Math.round(eth*ethClp).toLocaleString(\'es-CL\')+\' CLP)</span>\';}\n' +
'          return \'<div class="log \'+( l.type||\' \')+\'"><span class="t">\'+ftime(l.time)+\'</span><span class="msg">\'+msg+\'</span></div>\';\n' +
'        }).join(\'\'):\'<div class="empty">Sin actividad aún — polling cada 30s</div>\';\n' +
'      }catch(e){}\n' +
'    }\n' +
'    load();\n' +
'    setInterval(load,15000);\n' +
'  <\/script>\n' +
'</body>\n' +
'</html>';

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      agent: process.env.AGENT_ID,
      wallet: process.env.WALLET_ADDRESS,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      status: cashclawStatus,
      lastActivity,
      completedJobs: completedJobsCount,
      totalEarned: totalEarnedEth,
      restarts: restartCount
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
  res.end(DASHBOARD_HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard listo en http://0.0.0.0:${PORT}`);
  startCashclaw();
});

server.on('error', err => {
  console.error('Error servidor:', err.message);
  process.exit(1);
});
