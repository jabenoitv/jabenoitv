# FIX-SERVER — Registro de arreglos en server.js

Fecha: 2026-05-30
Archivo: /home/user/jabenoitv/server.js (1246 líneas tras cambios)

Nota general: La gran mayoría de los bugs YA estaban arreglados en el archivo
al momento de auditarlo (probablemente por una pasada previa). Solo el bug #9
(/health) faltaba. Confirmé cada uno individualmente y dejo el estado abajo.

## Bug 1 — saveState no atómico (CRÍTICO)
ESTADO: NO-APLICA (ya arreglado).
Líneas 258-272. saveState() ya escribe a `STATE_FILE + '.tmp'` y luego
`fs.renameSync(tmp, STATE_FILE)`, dentro de try/catch. Nada que cambiar.

## Bug 2 — cashclaw no se mata en SIGTERM + sin guardia de reentrancia
ESTADO: NO-APLICA (ya arreglado).
- 2a: línea 220 `let shuttingDown = false;`; handler SIGTERM (276-282) pone
  `shuttingDown = true` y `cashclawProc.kill('SIGTERM')` en try/catch antes de exit.
- 2b: startCashclaw (línea 604) ya tiene `if (cashclawProc && !cashclawProc.killed) return;`.
- 2c: handler exit (línea 618) ya hace `if (shuttingDown) { cashclawStatus='stopped'; return; }`.

## Bug 3 — restartTimes no se resetea tras pausa de loop (ALTO)
ESTADO: NO-APLICA (ya arreglado).
Línea 628: al programar la pausa de 5 min ya se hace `restartTimes.length = 0;`.

## Bug 4 — Sin timeout en https.get (MEDIO)
ESTADO: NO-APLICA (ya arreglado).
- fetchEthPrice: línea 135 `req.setTimeout(15000, () => req.destroy(new Error('timeout')));`
- fetchMarketPrices: línea 204, idem.
- postToFarcaster: línea 309, idem (sobre https.request).
Todos manejan el error vía el `.on('error')` existente.

## Bug 5 — /siwn sin auth permite secuestro del signer (CRÍTICO seguridad)
ESTADO: NO-APLICA (ya arreglado).
Endpoint /siwn (líneas 1172-1207). Ya valida formato UUID con regex
`/^[0-9a-f]{8}-...$/i` (responde 400 si no), y ya hay log WARNING prominente
`[SEGURIDAD] *** /siwn recibido ***`. No se valida contra Neynar (correcto).

## Bug 6 — Fail-open de checkAuth sin aviso (MEDIO)
ESTADO: NO-APLICA (ya arreglado).
checkAuth línea 1047-1048 mantiene `if (!DASHBOARD_SECRET) return true;`.
El aviso al boot ya existe en líneas 61-65 (console.warn prominente cuando
DASHBOARD_SECRET está vacío).

## Bug 7 — claimedBounties.add antes de confirmar (MEDIO)
ESTADO: NO-APLICA (ya arreglado).
claimOpenBounties (líneas 564-576). `claimedBounties.add(String(b.id))` ahora
está DENTRO del `else` (rama de éxito, línea 570), no antes del claim.

## Bug 8 — Parche de cashclaw asume OK sin verificar (MEDIO)
ESTADO: NO-APLICA (ya arreglado).
Bloque de parcheo (líneas 67-90). La rama `else` (línea 82-88) ahora verifica
explícitamente `src.includes('var PORT = ' + CASHCLAW_PORT) || src.includes('localhost:' + CASHCLAW_PORT)`
y loguea un `[WARNING]` si el patrón no se encuentra.

## Bug 9 — Endpoint /health para Railway healthcheck
ESTADO: ARREGLADO.
Líneas tocadas: handler HTTP, justo después de `const url = req.url.split('?')[0];`
y ANTES de `if (!checkAuth(req, res)) return;` (≈ líneas 1056-1059).
Cambio: agregué
```
if (url === '/health') {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  return res.end(JSON.stringify({ ok: true, status: cashclawStatus, uptime: Math.floor((Date.now() - startTime) / 1000) }));
}
```
No requiere auth (está antes de checkAuth). No toqué DASHBOARD_HTML.

## Validación
- `node --check server.js`: SYNTAX OK tras el cambio.
- Server arrancado con `PORT=3815 node server.js` (3s):
  - `GET /health` -> `{"ok":true,"status":"restarting","uptime":2}` (JSON correcto).
  - `GET /snapshot` -> sigue devolviendo el snapshot de texto correctamente.
  - `GET /` -> dashboard servido (24293 bytes).
- Test de JS del browser: extraje el contenido entre <script>...</script> del
  HTML servido (1 bloque, 13645 chars) y lo pasé por `new Function(js)`:
  resultado **BROWSER JS: OK**. El dashboard NO está roto.
