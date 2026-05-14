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
  // Nuevo trabajo recibido / aceptado
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

  // Trabajo completado / entregado
  if (/complet|finish|done.*task|task.*done|submit|deliver/i.test(line)) {
    const active = jobs.find(j => j.status === 'activo');
    if (active) {
      active.status = 'completado';
      active.completedTime = time;
      completedJobsCount++;
    }
  }

  // Pago recibido
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
  cashclawProc.on('exit', (code) => {
    restartCount++;
    const msg = `CashClaw salió (código ${code}) — reiniciando en 15s (#${restartCount})`;
    console.log(msg);
    addLog(msg, 'warn');
    cashclawStatus = 'restarting';
    setTimeout(startCashclaw, 15000);
  });
}

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
    .cards{display:flex;gap:14px;padding:20px 24px 0;flex-wrap:wrap}
    .card{background:#1e293b;border-radius:12px;padding:18px 20px;flex:1;min-width:150px;border:1px solid #334155}
    .card label{font-size:.72em;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
    .card .val{font-size:1.4em;font-weight:700;margin-top:6px;color:#f1f5f9}
    .card .val.small{font-size:1em}
    .card .val.mono{font-size:.85em;font-family:monospace;color:#94a3b8}
    .card .sub{font-size:.75em;color:#64748b;margin-top:3px}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;margin-right:8px;animation:pulse 2s infinite}
    .dot.warn{background:#f59e0b}.dot.off{background:#ef4444}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .tags{padding:16px 24px;display:flex;flex-wrap:wrap;gap:8px}
    .tag{background:#0f3460;color:#38bdf8;border:1px solid #1e4d8c;border-radius:20px;padding:4px 12px;font-size:.75em}
    .section{margin:16px 24px 0;background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden}
    .section-hdr{padding:14px 20px;border-bottom:1px solid #334155;font-size:.82em;color:#94a3b8;display:flex;justify-content:space-between;align-items:center}
    .log{padding:7px 20px;border-bottom:1px solid #162032;font-family:monospace;font-size:.8em;display:flex;gap:14px;line-height:1.5}
    .log:last-child{border-bottom:none}
    .log .t{color:#475569;white-space:nowrap;flex-shrink:0}
    .log .msg{color:#cbd5e1;word-break:break-all}
    .log.error .msg{color:#fca5a5}.log.warn .msg{color:#fbbf24}
    .job-row{padding:12px 20px;border-bottom:1px solid #162032;display:flex;gap:12px;align-items:flex-start;font-size:.82em}
    .job-row:last-child{border-bottom:none}
    .badge{padding:3px 10px;border-radius:12px;font-size:.72em;font-weight:700;white-space:nowrap;flex-shrink:0;margin-top:2px}
    .badge.activo{background:#422006;color:#fbbf24;border:1px solid #92400e}
    .badge.completado{background:#0c1a2e;color:#60a5fa;border:1px solid #1d4ed8}
    .badge.pagado{background:#052e16;color:#4ade80;border:1px solid #166534}
    .job-body{flex:1;min-width:0}
    .job-desc{color:#cbd5e1;word-break:break-word}
    .job-meta{font-size:.75em;color:#475569;margin-top:3px}
    .job-earn{color:#4ade80;font-weight:700;white-space:nowrap;font-family:monospace;flex-shrink:0;font-size:.85em;margin-top:2px}
    .empty{padding:40px;text-align:center;color:#475569;font-size:.9em}
    .footer{text-align:center;padding:16px;color:#475569;font-size:.78em;margin-top:16px}
    .footer a{color:#38bdf8;text-decoration:none}
  </style>
</head>
<body>
  <header>
    <h1>⚡ CashClaw Dashboard</h1>
    <p>Agente autónomo · Moltlaunch Marketplace · ID #${process.env.AGENT_ID || '51049'}</p>
  </header>

  <div class="cards">
    <div class="card"><label>Estado</label><div class="val" id="st"><span class="dot"></span>...</div></div>
    <div class="card"><label>Tiempo activo</label><div class="val" id="up">-</div></div>
    <div class="card"><label>Wallet</label><div class="val mono" id="wal">-</div></div>
    <div class="card"><label>Reinicios</label><div class="val" id="rc">0</div></div>
  </div>

  <div class="cards" style="padding:14px 24px 0">
    <div class="card"><label>1 ETH en USD</label><div class="val small" id="eth-usd">...</div></div>
    <div class="card"><label>1 ETH en CLP</label><div class="val small" id="eth-clp">...</div></div>
    <div class="card"><label>Tarifa del agente</label><div class="val small" id="rate-usd">...</div><div class="sub" id="rate-clp"></div></div>
    <div class="card"><label>Total ganado</label><div class="val small" id="total-eth" style="color:#4ade80">0 ETH</div><div class="sub" id="total-usd">esperando pagos...</div></div>
  </div>

  <div class="tags">
    <span class="tag">writing</span><span class="tag">copywriting</span><span class="tag">blog-writing</span>
    <span class="tag">email-writing</span><span class="tag">social-media-content</span>
    <span class="tag">research</span><span class="tag">web-research</span><span class="tag">data-analysis</span>
    <span class="tag">coding</span><span class="tag">debugging</span><span class="tag">translation</span>
    <span class="tag">brainstorming</span><span class="tag">consulting</span><span class="tag">+23 más</span>
  </div>

  <div class="section">
    <div class="section-hdr">
      <span>📋 Registro de Trabajos</span>
      <span id="jobs-cnt" style="color:#64748b">Sin trabajos aún</span>
    </div>
    <div id="jobs-list"><div class="empty">Esperando primer trabajo del marketplace...</div></div>
  </div>

  <div class="section">
    <div class="section-hdr">
      <span>📡 Actividad reciente</span>
      <span id="log-cnt" style="color:#64748b">-</span>
    </div>
    <div id="log-list"><div class="empty">Cargando...</div></div>
  </div>

  <div class="footer">Actualización cada 15 seg · <a href="/">Actualizar ahora</a> · Precio ETH cada 5 min</div>

  <script>
    function fmt(s){const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return h?h+'h '+m+'m':m?m+'m '+sec+'s':sec+'s'}
    function ftime(iso){return new Date(iso).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
    function fdate(iso){const d=new Date(iso);return d.toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'})+' '+ftime(iso)}
    function fdur(a,b){if(!b)return 'activo';const mins=Math.round((new Date(b)-new Date(a))/60000);return mins<1?'<1 min':mins+'min'}
    const dotClass={running:'dot',restarting:'dot warn',starting:'dot warn',stopped:'dot off'};
    const colors={running:'#4ade80',restarting:'#fbbf24',starting:'#94a3b8',stopped:'#f87171'};

    let ethUsd=0,ethClp=0;

    async function loadPrice(){
      try{
        const d=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,clp').then(r=>r.json());
        ethUsd=d.ethereum.usd;
        ethClp=d.ethereum.clp;
        document.getElementById('eth-usd').textContent='$'+ethUsd.toLocaleString('en-US',{maximumFractionDigits:0})+' USD';
        document.getElementById('eth-clp').textContent='$'+(ethClp).toLocaleString('es-CL',{maximumFractionDigits:0})+' CLP';
        const rateEth=0.005;
        document.getElementById('rate-usd').textContent='$'+(rateEth*ethUsd).toFixed(2)+' USD / trabajo';
        document.getElementById('rate-clp').textContent='≈ $'+Math.round(rateEth*ethClp).toLocaleString('es-CL')+' CLP';
      }catch(e){
        document.getElementById('eth-usd').textContent='No disponible';
      }
    }

    function ethLine(eth){
      if(!eth||eth<=0)return'';
      let s=eth+' ETH';
      if(ethUsd) s+=' = $'+(eth*ethUsd).toFixed(2)+' USD / $'+Math.round(eth*ethClp).toLocaleString('es-CL')+' CLP';
      return s;
    }

    async function load(){
      try{
        const [st,ls,jd]=await Promise.all([
          fetch('/api/status').then(r=>r.json()),
          fetch('/api/logs').then(r=>r.json()),
          fetch('/api/jobs').then(r=>r.json())
        ]);

        document.getElementById('st').innerHTML='<span class="'+(dotClass[st.status]||'dot')+'"></span><span style="color:'+(colors[st.status]||'#fff')+'">'+st.status+'</span>';
        document.getElementById('up').textContent=fmt(st.uptime);
        document.getElementById('wal').textContent=st.wallet?st.wallet.slice(0,6)+'...'+st.wallet.slice(-4):'-';
        document.getElementById('rc').textContent=st.restarts;

        const te=jd.totalEarned||0;
        document.getElementById('total-eth').textContent=te>0?te.toFixed(6)+' ETH':'0 ETH';
        if(ethUsd&&te>0){
          document.getElementById('total-usd').textContent='$'+(te*ethUsd).toFixed(2)+' USD / $'+Math.round(te*ethClp).toLocaleString('es-CL')+' CLP';
        }

        const jobs=jd.jobs||[];
        const completed=jd.completed||0;
        document.getElementById('jobs-cnt').textContent=jobs.length?completed+' completados · '+jobs.length+' total':'Sin trabajos aún';
        const jel=document.getElementById('jobs-list');
        jel.innerHTML=jobs.length?jobs.map(j=>{
          const earnStr=j.earnedEth?'<div class="job-earn">'+ethLine(j.earnedEth)+'</div>':'';
          const dur=fdur(j.startTime,j.completedTime);
          return '<div class="job-row">'+
            '<span class="badge '+j.status+'">'+j.status+'</span>'+
            '<div class="job-body"><div class="job-desc">'+j.description.replace(/</g,'&lt;')+'</div>'+
            '<div class="job-meta">'+fdate(j.startTime)+' · '+dur+'</div></div>'+
            earnStr+'</div>';
        }).join(''):'<div class="empty">Esperando primer trabajo del marketplace...</div>';

        document.getElementById('log-cnt').textContent=ls.length+' eventos';
        const el=document.getElementById('log-list');
        el.innerHTML=ls.length?[...ls].reverse().map(l=>{
          let msg=l.msg.replace(/</g,'&lt;');
          const ethMatch=msg.match(/([0-9.]+)\s*ETH/);
          if(ethMatch&&ethUsd){
            const eth=parseFloat(ethMatch[1]);
            const usd='$'+(eth*ethUsd).toFixed(2)+' USD';
            const clp='$'+Math.round(eth*ethClp).toLocaleString('es-CL')+' CLP';
            msg=msg+' <span style="color:#4ade80;font-weight:bold">('+usd+' / '+clp+')</span>';
          }
          return '<div class="log '+(l.type||'')+'">'+'<span class="t">'+ftime(l.time)+'</span><span class="msg">'+msg+'</span></div>';
        }).join(''):'<div class="empty">Sin actividad aún — polling cada 30s</div>';
      }catch(e){}
    }

    loadPrice();
    setInterval(loadPrice,5*60*1000);
    load();
    setInterval(load,15000);
  </script>
</body>
</html>`;

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
  if (url === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(logs));
  }
  if (url === '/api/jobs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      jobs,
      totalEarned: totalEarnedEth,
      completed: completedJobsCount,
      count: jobs.length
    }));
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
