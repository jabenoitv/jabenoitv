# FIX-BOUNTIES — Registro de arreglos

Archivo objetivo: `/home/user/jabenoitv/farcaster-bounties.js`
Fecha: 2026-05-30
Modelo `claude-sonnet-4-6` conservado (válido, sin tocar).

NOTA DE ESTADO: al iniciar, el working tree ya contenía TODOS los arreglos
aplicados (diff sin commitear contra HEAD `c85f089`). HEAD aún tiene los bugs
originales; el working tree los corrige. Esto corresponde a una ejecución previa
de este mismo agente cuyo commit aún no realizó el orquestador. Verifiqué cada
arreglo línea por línea contra la descripción del bug. `node --check` pasa OK.

---

## Bug 1 — Contador de submissions diarias roto (CRÍTICO)
- Estado: ARREGLADO
- Línea: 450
- Cambio: `todaySubmissions + 1;` (expresión muerta) → `todaySubmissions++;`
- Validación: el guard `if (todaySubmissions >= MAX_SUBMISSIONS_PER_DAY) break;`
  (línea 355) ahora se incrementa de verdad dentro del mismo scan.

## Bug 2 — bountiesSeen crece sin límite (ALTO)
- Estado: ARREGLADO
- Líneas: 36-47 (nueva `purgeSeen` + `SEEN_TTL_MS`), 441, 464, 476
- Cambio: añadida función `purgeSeen(seen)` que descarta entradas con timestamp
  > 7 días o no numérico (mantiene formato `{ hash: timestamp }`). Se aplica
  `s.bountiesSeen = purgeSeen(seen)` en los tres puntos de guardado (dry-run,
  post-submit, y guardado final del scan).
- Validación: revisión de los tres `saveState` que tocan `bountiesSeen`.

## Bug 3 — Marca 'seen' antes de evaluar (ALTO/MEDIO)
- Estado: ARREGLADO
- Líneas: 359-367 (eliminado el `seen[...] = Date.now()` up-front), 365, 372,
  378, 382, 400, 432, 439, 449; catch en 392, 412, 422, 470
- Cambio: se eliminó el marcado incondicional al inicio del loop. Ahora `seen`
  se marca SOLO tras decisión definitiva: sin parent_author, dust, disqualify,
  sin keyword elegible, no elegible, score bajo, dry-run mostrado, o submit OK.
  Los catch de classify/generate/critique/submit hacen `continue` SIN marcar
  seen, permitiendo reintento en el próximo scan ante errores transitorios.
- Validación: revisión de cada rama `continue` y de los cuatro try/catch de API.

## Bug 4 — claudeChat sin retry en 429/529 (ALTO)
- Estado: ARREGLADO
- Líneas: 91 (rename a `claudeChatOnce`), 109-112 (adjunta `err.statusCode`),
  126-141 (nueva `claudeChat` con backoff)
- Cambio: la función de red se renombró a `claudeChatOnce` y adjunta
  `err.statusCode`. Nueva `claudeChat` async envuelve con reintentos
  exponenciales (2s/4s/8s, 3 reintentos) SOLO para statusCode 429 y 529; otros
  errores fallan inmediatamente como antes.
- Validación: `node --check` OK; firma de `claudeChat` sin cambios para callers.

## Bug 5 — Parseo de JSON de Claude frágil (BAJO/MEDIO)
- Estado: ARREGLADO
- Líneas: 235-236 (classifyBounty), 289-290 (critiqueDeliverable)
- Cambio: antes de `JSON.parse`, se extrae el primer objeto con
  `(text||'').match(/\{[\s\S]*\}/)`; si no hay match, fallback al strip de
  fences mejorado `/```[jJ][sS][oO][nN]?|```/g` (cubre ```JSON mayúscula).
  Se mantiene el try/catch con sus defaults.
- Validación: lógica revisada; cubre texto antes/después del bloque.

## Bug 6 — Validación de tipo de score/confidence (MEDIO)
- Estado: ARREGLADO
- Líneas: 238-243 y 396-397 (confidence), 292-296 y 426-429 (score)
- Cambio: `confidence` y `score` se envuelven con `Number()` y se validan con
  `Number.isFinite`. Si no es finito: confidence → eligible=false, score → 0;
  además la comparación en el motor revalida con `Number.isFinite` antes de
  comparar contra MIN_CONFIDENCE / MIN_SELF_SCORE.
- Validación: doble defensa (parse + comparación).

## Bug 7 — parent_author ausente (MEDIO)
- Estado: ARREGLADO
- Líneas: 209 (`hasParentAuthor` en fetchBounties), 363-367 (descarte + log)
- Cambio: cada bounty lleva `hasParentAuthor: !!(c.parent_author && c.parent_author.fid)`.
  En el loop, si falta, se loguea y se descarta (marcado seen, continue) antes de
  cualquier llamada a Claude o submit.
- Validación: descarte temprano, no se intenta postear.

## Bug 8 — Truncado del entregable a 1020 chars (BAJO)
- Estado: ARREGLADO
- Líneas: 306-312 (submitBounty)
- Cambio: en vez de `deliverable.slice(0,1020)`, ahora corta a 1019, busca el
  último límite de palabra (`/\s\S*$/`), recorta ahí si no degrada texto corto
  (umbral 200), limpia espacios finales y añade indicador `…`.
- Validación: respeta el límite de ~1024 y evita cortar a mitad de palabra.

---

## Resumen
8/8 bugs ARREGLADOS. `node --check /home/user/jabenoitv/farcaster-bounties.js`
pasa sin errores. No se tocó ningún otro archivo de código. No se realizaron
operaciones git (las hace el orquestador).
