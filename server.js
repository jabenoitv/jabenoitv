const http = require('http');
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

const logs = [];
const MAX_LOGS = 300;
let tasksDetected = 0;
let lastActivity = null;
let cashclawProc = null;

function addLog(line, type) {
  const entry = { time: new Date().toISOString(), msg: line.trim(), type };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  lastActivity = entry.time;
  if (/task|job|work|tarea|earn|payment|paid/i.test(line)) tasksDetected++;
}

const PORT = Number(process.env.PORT || 3777);
const startTime = Date.now();

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CashClaw · Agente ${process.env.AGENT_ID || '51049'}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
    header{background:#1e293b;padding:20px 24px;border-bottom:1px solid #334155}
    header h1{font-size:1.3em;color:#38bdf8}header p{color:#94a3b8;font-size:.82em;margin-top:3px}
    .cards{display:flex;gap:14px;padding:20px 24px;flex-wrap:wrap}
    .card{background:#1e293b;border-radius:12px;padding:18px 20px;flex:1;min-width:150px;border:1px solid #334155}
    .card label{font-size:.72em;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
    .card .val{font-size:1.4em;font-weight:700;margin-top:6px;color:#f1f5f9}
    .card .val.mono{font-size:.85em;font-family:monospace;color:#94a3b8}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;margin-right:8px;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .tags{padding:0 24px 20px;display:flex;flex-wrap:wrap;gap:8px}
    .tag{background:#0f3460;color:#38bdf8;border:1px solid #1e4d8c;border-radius:20px;padding:4px 12px;font-size:.75em}
    .logs{margin:0 24px 24px;background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden}
    .logs-hdr{padding:14px 20px;border-bottom:1px solid #334155;font-size:.82em;color:#94a3b8;display:flex;justify-content:space-between}
    .log{padding:7px 20px;border-bottom:1px solid #162032;font-family:monospace;font-size:.8em;display:flex;gap:14px;line-height:1.5}
    .log:last-child{border-bottom:none}
    .log .t{color:#475569;white-space:nowrap;flex-shrink:0}
    .log .msg{color:#cbd5e1;word-break:break-all}
    .log.err .msg{color:#fca5a5}
    .empty{padding:40px;text-align:center;color:#475569}
    .footer{text-align:center;padding:14px;color:#475569;font-size:.78em}
    .footer a{color:#38bdf8;text-decoration:none}
  </style>
</head>
<body>
  <header><h1>⚡ CashClaw Dashboard</h1><p>Agente autónomo · Moltlaunch Marketplace</p></header>
  <div class="cards">
    <div class="card"><label>Estado</label><div class="val" id="st"><span class="dot"></span>...</div></div>
    <div class="card"><label>Agente ID</label><div class="val" id="aid">-</div></div>
    <div class="card"><label>Tiempo activo</label><div class="val" id="up">-</div></div>
    <div class="card"><label>Wallet</label><div class="val mono" id="wal">-</div></div>
    <div class="card"><label>Última actividad</label><div class="val" id="la" style="font-size:.85em">-</div></div>
  </div>
  <div class="tags">
    <span class="tag">writing</span><span class="tag">copywriting</span><span class="tag">blog-writing</span>
    <span class="tag">email-writing</span><span class="tag">social-media-content</span><span class="tag">technical-writing</span>
    <span class="tag">research</span><span class="tag">web-research</span><span class="tag">data-analysis</span>
    <span class="tag">coding</span><span class="tag">debugging</span><span class="tag">code-review</span>
    <span class="tag">translation</span><span class="tag">web-scraping</span><span class="tag">brainstorming</span>
    <span class="tag">consulting</span>
  </div>
  <div class="logs">
    <div class="logs-hdr"><span>Actividad reciente</span><span id="cnt">-</span></div>
    <div id="list"><div class="empty">Cargando...</div></div>
  </div>
  <div class="footer">Actualización cada 15 seg · <a href="/">Actualizar ahora</a></div>
  <script>
    function fmt(s){const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return h?h+'h '+m+'m':m?m+'m '+sec+'s':sec+'s'}
    function ftime(iso){return new Date(iso).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
    async function load(){
      try{
        const [st,ls]=await Promise.all([fetch('/api/status').then(r=>r.json()),fetch('/api/logs').then(r=>r.json())]);
        document.getElementById('st').innerHTML='<span class="dot"></span>'+(st.status==='running'?'<span style="color:#4ade80">Activo</span>':'<span style="color:#f87171">Detenido</span>');
        document.getElementById('aid').textContent='#'+st.agent;
        document.getElementById('up').textContent=fmt(st.uptime);
        document.getElementById('wal').textContent=st.wallet?st.wallet.slice(0,6)+'...'+st.wallet.slice(-4):'-';
        document.getElementById('la').textContent=st.lastActivity?ftime(st.lastActivity):'Sin actividad aún';
        document.getElementById('cnt').textContent=ls.length+' eventos';
        const el=document.getElementById('list');
        el.innerHTML=ls.length?[...ls].reverse().map(l=>'<div class="log'+(l.type==="error"?' err':'')+'" ><span class="t">'+ftime(l.time)+'</span><span class="msg">'+l.msg.replace(/</g,'&lt;')+'</span></div>').join(''):'<div class="empty">Sin actividad aún — el agente hace polling cada 30 segundos</div>';
      }catch(e){}
    }
    load();
    setInterval(load,15000);
  </script>
</body></html>`;

// Claim the port FIRST before spawning cashclaw
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      agent: process.env.AGENT_ID,
      wallet: process.env.WALLET_ADDRESS,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      status: cashclawProc && cashclawProc.exitCode === null ? 'running' : 'stopped',
      lastActivity,
      tasksDetected
    }));
  }

  if (url === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(logs));
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(DASHBOARD_HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard listo en http://0.0.0.0:${PORT}`);

  // Spawn cashclaw AFTER our server has the port
  // Give cashclaw PORT+1 so it doesn't conflict if it starts its own server
  const binPath = path.join(process.cwd(), 'node_modules', '.bin', 'cashclaw');
  const env = { ...process.env, PORT: String(PORT + 1) };

  cashclawProc = spawn(fs.existsSync(binPath) ? binPath : 'cashclaw', [], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env
  });

  cashclawProc.stdout.on('data', d =>
    d.toString().split('\n').filter(l => l.trim()).forEach(l => {
      process.stdout.write(l + '\n');
      addLog(l, 'info');
    })
  );

  cashclawProc.stderr.on('data', d =>
    d.toString().split('\n').filter(l => l.trim()).forEach(l => {
      process.stderr.write(l + '\n');
      addLog(l, 'error');
    })
  );

  cashclawProc.on('exit', code => {
    addLog(`CashClaw terminó con código ${code}`, 'error');
    process.exit(code || 0);
  });
});

server.on('error', err => {
  console.error('Error del servidor:', err.message);
  process.exit(1);
});
