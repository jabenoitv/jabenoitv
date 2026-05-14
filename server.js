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
  llm: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY || '', model: 'claude-sonnet-4-20250514' }
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
    console.log('Cashclaw parcheado: puerto ' + CASHCLAW_PORT);
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

// ETH price
let ethPrice = { usd: 0, clp: 0, updatedAt: null };
function fetchEthPrice() {
  https.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,clp',
    { headers: { 'User-Agent': 'cashclaw-dashboard/1.0' } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const d = JSON.parse(body);
          if (d.ethereum) {
            ethPrice = { usd: d.ethereum.usd, clp: d.ethereum.clp, updatedAt: new Date().toISOString() };
            console.log('Precio ETH: $' + ethPrice.usd + ' USD');
            broadcast({ type: 'price', usd: ethPrice.usd, clp: ethPrice.clp, updatedAt: ethPrice.updatedAt });
          }
        } catch (e) { console.log('Error precio ETH:', e.message); }
      });
    }).on('error', e => { console.log('No se pudo obtener precio ETH:', e.message); });
}
fetchEthPrice();
setInterval(fetchEthPrice, 5 * 60 * 1000);

// Inteligencia de mercado
const PRICE_FLOOR = 0.0005;  // nunca trabajar con menos (cubre costo API)
const PRICE_CEIL  = 0.02;    // techo razonable
let marketData = { agents: 0, median: 0, ourPrice: 0.005, min: 0, max: 0, lastScan: null };

function fetchMarketPrices() {
  https.get('https://api.moltlaunch.com/api/agents',
    { headers: { 'User-Agent': 'cashclaw-monitor/1.0' } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
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
          // 10% bajo la mediana, con piso y techo
          const competitive = Math.max(PRICE_FLOOR, Math.min(PRICE_CEIL, median * 0.90));
          const competitiveStr = competitive.toFixed(6);

          // Actualizar workclaw.json con nuevo precio
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
}
fetchMarketPrices();
setInterval(fetchMarketPrices, 30 * 60 * 1000);

// Estado del agente
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
    }
  }
}

function addLog(line, type) {
  const entry = { time: new Date().toISOString(), msg: line.trim(), type };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  lastActivity = entry.time;
  const prevJobs = jobs.length;
  const prevEarned = totalEarnedEth;
  detectJobEvent(line, entry.time);
  broadcast({
    type: 'update', totalEarned: totalEarnedEth, jobCount: jobs.length,
    newJob: jobs.length > prevJobs ? jobs[0].description : null,
    newPayment: totalEarnedEth > prevEarned ? (totalEarnedEth - prevEarned).toFixed(6) : null
  });
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
    const msg = 'CashClaw salio (codigo ' + code + ') reiniciando en 15s (#' + restartCount + ')';
    console.log(msg); addLog(msg, 'warn');
    cashclawStatus = 'restarting';
    setTimeout(startCashclaw, 15000);
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
.ldot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#ef4444;margin-right:5px;vertical-align:middle;transition:background .5s}
.ldot.on{background:#22c55e;animation:pulse 1.5s infinite}
.empty{padding:28px;text-align:center;color:#475569;font-size:.86em}
.footer{text-align:center;padding:12px;color:#475569;font-size:.72em;margin-top:12px}
.footer a{color:#38bdf8;text-decoration:none}
</style>
</head>
<body>
<header>
  <div>
    <h1>CashClaw</h1>
    <p style="color:#94a3b8;font-size:.73em;margin-top:2px">ID #${AGENT_ID} - Moltlaunch Marketplace</p>
  </div>
  <div class="hdr-r">
    <span id="hst" style="font-size:.75em;color:#94a3b8">conectando...</span>
    <button class="nbtn" id="nb">Alertas</button>
  </div>
</header>
<div class="earn" id="earn">
  <div class="earn-lbl">Ganancias totales</div>
  <div class="earn-eth" id="earn-eth">0.000000 ETH</div>
  <div class="earn-fiat">
    <span id="earn-usd">$ 0.00 USD</span>
    <span class="sep">|</span>
    <span id="earn-clp">$ 0 CLP</span>
  </div>
  <div class="earn-ts" id="earn-ts">conectando...</div>
</div>
<div class="cards">
  <div class="card"><label>Estado</label><div class="v" id="st"><span class="dot warn"></span>...</div></div>
  <div class="card"><label>Activo</label><div class="v" id="up">-</div></div>
  <div class="card"><label>Trabajos</label><div class="v" id="jbadge">0</div></div>
  <div class="card"><label>Wallet</label><div class="v mo" id="wal">-</div></div>
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
  <div class="sec-h"><span><span class="ldot" id="ldot"></span>Actividad reciente</span><span id="lcnt" style="color:#64748b">-</span></div>
  <div id="llist"><div class="empty">Cargando...</div></div>
</div>
<div class="footer"><a href="/">Refrescar</a></div>
<script>
var ethUsd=0,ethClp=0,prevEarned=0,prevJC=0,notifOk=false,loadTmr=null;

function fmt(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60),sc=s%60;return h?h+'h '+m+'m':m?m+'m '+sc+'s':sc+'s';}
function ftime(iso){return new Date(iso).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function fdate(iso){var d=new Date(iso);return d.toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'})+' '+ftime(iso);}
function fdur(a,b){if(!b)return 'activo';var m=Math.round((new Date(b)-new Date(a))/60000);return m<1?'<1min':m+'min';}
function fN(n,d){return n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
function fEth(v){return v.toFixed(6)+' ETH';}
function fUsd(v){return '$ '+fN(v,2)+' USD';}
function fClp(v){return '$ '+Math.round(v).toLocaleString('es-CL')+' CLP';}
var dC={running:'dot',restarting:'dot warn',starting:'dot warn',stopped:'dot off'};

(function(){
  try{
    var s=JSON.parse(localStorage.getItem('claw')||'null');
    if(s&&s.eth>0){
      document.getElementById('earn-eth').textContent=s.eth.toFixed(6)+' ETH';
      if(s.usd)document.getElementById('earn-usd').textContent='$ '+s.usd+' USD';
      if(s.clp)document.getElementById('earn-clp').textContent='$ '+s.clp+' CLP';
      prevEarned=s.eth;
    }
  }catch(e){}
})();

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
  if(te!==prevEarned){
    animNum(document.getElementById('earn-eth'),prevEarned,te,800,fEth);
    if(ethUsd){animNum(document.getElementById('earn-usd'),prevEarned*ethUsd,te*ethUsd,800,fUsd);animNum(document.getElementById('earn-clp'),prevEarned*ethClp,te*ethClp,800,fClp);}
    if(te>prevEarned){flashBanner();if(notifOk){var d=(te-prevEarned).toFixed(6);try{new Notification('Pago recibido',{body:d+' ETH',tag:'cp',requireInteraction:false});}catch(ex){}}}
    prevEarned=te;
    try{localStorage.setItem('claw',JSON.stringify({eth:te,usd:ethUsd?(te*ethUsd).toFixed(2):'0.00',clp:ethClp?Math.round(te*ethClp).toString():'0'}));}catch(ex){}
  }else{
    document.getElementById('earn-eth').textContent=fEth(te);
    if(ethUsd){document.getElementById('earn-usd').textContent=fUsd(te*ethUsd);document.getElementById('earn-clp').textContent=fClp(te*ethClp);}
  }
}

function updateMarket(mk){
  if(!mk||!mk.median)return;
  document.getElementById('mkt-med').textContent=mk.median.toFixed(6)+' ETH';
  document.getElementById('mkt-our').textContent=mk.ourPrice.toFixed(6)+' ETH';
  if(ethUsd){
    document.getElementById('mkt-med-usd').textContent='$'+fN(mk.median*ethUsd,2)+' USD';
    document.getElementById('mkt-our-usd').textContent='$'+fN(mk.ourPrice*ethUsd,2)+' USD';
  }
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

async function load(){
  try{
    var r=await Promise.all([
      fetch('/api/status').then(function(x){return x.json();}),
      fetch('/api/logs').then(function(x){return x.json();}),
      fetch('/api/jobs').then(function(x){return x.json();}),
      fetch('/api/price').then(function(x){return x.json();}),
      fetch('/api/market').then(function(x){return x.json();})
    ]);
    var st=r[0],ls=r[1],jd=r[2],pr=r[3],mk=r[4];
    if(pr.usd>0){ethUsd=pr.usd;ethClp=pr.clp;document.getElementById('earn-ts').textContent='1 ETH = $'+fN(pr.usd,0)+' USD - actualizado '+ftime(new Date().toISOString());}
    updateEarnings(jd.totalEarned||0);
    updateMarket(mk);
    var jcount=jd.count||0;
    if(jcount>prevJC&&prevJC>0&&notifOk&&jd.jobs&&jd.jobs[0]){try{new Notification('Nuevo trabajo',{body:jd.jobs[0].description.slice(0,80),tag:'cj',requireInteraction:false});}catch(ex){}}
    prevJC=jcount;
    document.getElementById('st').innerHTML='<span class="'+(dC[st.status]||'dot')+'"></span>'+st.status;
    document.getElementById('hst').innerHTML='<span class="'+(dC[st.status]||'dot')+'"></span>'+st.status+' - '+fmt(st.uptime);
    document.getElementById('up').textContent=fmt(st.uptime);
    document.getElementById('wal').textContent=st.wallet?st.wallet.slice(0,6)+'...'+st.wallet.slice(-4):'-';
    var jobs=jd.jobs||[];
    document.getElementById('jbadge').textContent=(jd.completed||0)+' completados';
    document.getElementById('jcnt').textContent=jobs.length?(jd.completed||0)+' completados - '+jobs.length+' total':'Sin trabajos aun';
    var jel=document.getElementById('jlist');
    jel.innerHTML=jobs.length?jobs.map(function(j){
      var es=j.earnedEth?'<div class="je">'+ethLine(j.earnedEth)+'</div>':'';
      return '<div class="jr"><span class="bdg '+j.status+'">' +j.status+'</span><div class="jb"><div class="jd">'+j.description.replace(/</g,'&lt;')+'</div><div class="jm">'+fdate(j.startTime)+' - '+fdur(j.startTime,j.completedTime)+'</div></div>'+es+'</div>';
    }).join(''):'<div class="empty">Esperando primer trabajo del marketplace...</div>';
    document.getElementById('lcnt').textContent=ls.length+' eventos';
    var lel=document.getElementById('llist');
    lel.innerHTML=ls.length?[].concat(ls).reverse().map(function(l){
      var msg=l.msg.replace(/</g,'&lt;');
      var em=msg.match(/([0-9.]+)\\s*ETH/);
      if(em&&ethUsd){var eth=parseFloat(em[1]);msg+=' <span style="color:#4ade80;font-weight:bold">($'+fN(eth*ethUsd,2)+' USD / $'+Math.round(eth*ethClp).toLocaleString('es-CL')+' CLP)</span>';}
      return '<div class="log '+(l.type||'')+'"><span class="t">'+ftime(l.time)+'</span><span class="msg">'+msg+'</span></div>';
    }).join(''):'<div class="empty">Sin actividad aun</div>';
  }catch(e){}
}

function schedLoad(){clearTimeout(loadTmr);loadTmr=setTimeout(load,300);}

var ldot=document.getElementById('ldot');
function connectSSE(){
  var es=new EventSource('/events');
  es.addEventListener('open',function(){ldot.classList.add('on');document.getElementById('earn-ts').textContent='en vivo';});
  es.onmessage=function(ev){
    try{
      var d=JSON.parse(ev.data);
      if(d.type==='price'){ethUsd=d.usd;ethClp=d.clp;if(prevEarned>0){document.getElementById('earn-usd').textContent=fUsd(prevEarned*ethUsd);document.getElementById('earn-clp').textContent=fClp(prevEarned*ethClp);}document.getElementById('earn-ts').textContent='1 ETH = $'+fN(d.usd,0)+' USD - actualizado '+ftime(new Date().toISOString());}
      if(d.type==='update')schedLoad();
      if(d.type==='market')updateMarket(d);
    }catch(ex){}
  };
  es.onerror=function(){ldot.classList.remove('on');es.close();setTimeout(connectSSE,5000);};
}
connectSSE();
load();
<\/script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': '*' });
    res.write('data: {"type":"connected"}\n\n');
    sseClients.push(res);
    req.on('close', () => { const i = sseClients.indexOf(res); if (i >= 0) sseClients.splice(i, 1); });
    return;
  }
  if (url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ agent: process.env.AGENT_ID, wallet: process.env.WALLET_ADDRESS,
      uptime: Math.floor((Date.now() - startTime) / 1000), status: cashclawStatus, lastActivity,
      completedJobs: completedJobsCount, totalEarned: totalEarnedEth, restarts: restartCount }));
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
  if (url === '/api/jobs') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ jobs, totalEarned: totalEarnedEth, completed: completedJobsCount, count: jobs.length }));
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(DASHBOARD_HTML);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Dashboard listo en http://0.0.0.0:' + PORT);
  startCashclaw();
});
server.on('error', err => { console.error('Error servidor:', err.message); process.exit(1); });
