# FIX-RAILWAY — Registro de arreglos de configuración de despliegue

Agente: FIX-RAILWAY
Fecha: 2026-05-30
Alcance: SOLO archivos de configuración de despliegue. No se tocó server.js ni
farcaster-bounties.js. No se hicieron commits/push (los hace el orquestador).

NOTA: Al iniciar, varios archivos ya presentaban los cambios objetivo aplicados
(working tree modificado, sin commit). Se verificó cada tarea contra el contenido
real en disco y contra `git diff HEAD` para confirmar correctitud. Donde el cambio
ya estaba correcto, se marca ARREGLADO (verificado) sin reescribir.

---

## Tarea 1 — Scrub del token Railway en railway.html
Estado: ARREGLADO (verificado)
Archivo: /home/user/jabenoitv/railway.html
Línea: 37 (input del token) y 39-43 (comentario de advertencia añadido)

Cambio:
- El input del token pasó de `value="8d85c544-..."` a `value=""` con placeholder
  "Pega tu Railway API token aquí".
- Se añadió un comentario HTML de ADVERTENCIA DE SEGURIDAD (líneas 39-43) indicando
  que los proxies CORS de terceros (corsproxy.io, codetabs.com, thingproxy) reciben
  el header Authorization con el token en texto plano y pueden registrarlo; se
  recomienda usar la página solo localmente y rotar el token tras usarla.
- La lógica de proxies NO se reescribió (solo se limpió el secreto y se documentó).

Validación:
- `grep -nE "value=\"[^\"]+\"|[0-9a-f]{8}-[0-9a-f]{4}|sk-ant-..."` sobre railway.html
  ya NO encuentra token alguno; los únicos `value="..."` restantes son las URLs de
  los `<option>` de proxy (no secretos). Sin otros tokens/secretos hardcodeados.

## Tarea 2 — Scrub de secretos en local-setup.sh
Estado: ARREGLADO (verificado)
Archivo: /home/user/jabenoitv/local-setup.sh

Cambio:
- El script ahora carga `.env` (no versionado) con `set -a; . ./.env; set +a`.
- Valida presencia de WALLET_ADDRESS, WALLET_PRIVATE_KEY y ANTHROPIC_API_KEY con
  `: "${VAR:?...}"` (falla con mensaje si faltan).
- wallet.json se genera con `${WALLET_ADDRESS}` / `${WALLET_PRIVATE_KEY}`.
- workclaw.json se genera con `${ANTHROPIC_API_KEY}`.
- Permisos 600 en ambos archivos generados. Sigue funcional leyendo de env vars.

Validación:
- `grep -nE "0x[0-9a-fA-F]{40,}|sk-ant-[A-Za-z0-9_-]{10}"` sobre local-setup.sh:
  sin coincidencias. No quedan secretos en texto plano.
- local-setup.sh NO está trackeado en git (está en .gitignore), por lo que el valor
  original no quedó en el historial del repo, pero SÍ estuvo en disco -> rotar.

## Tarea 3 — railway.json (restart policy + healthcheck)
Estado: ARREGLADO (verificado)
Archivo: /home/user/jabenoitv/railway.json (bloque deploy, líneas 7-12)

Cambio:
- `restartPolicyMaxRetries`: 3 -> 10
- Añadido `"healthcheckPath": "/health"`
- Añadido `"healthcheckTimeout": 30`
- (Usa /health, no /api/status, coordinado con FIX-SERVER.)

Validación:
- `node -e "JSON.parse(...)"` -> railway.json OK (JSON válido).

## Tarea 4 — GitHub Actions workflow (redeploy-railway.yml)
Estado: ARREGLADO (verificado)
Archivo: /home/user/jabenoitv/.github/workflows/redeploy-railway.yml

Cambios:
- Trigger: se eliminó `push: branches: [main]`; ahora es SOLO `workflow_dispatch`
  (evita doble-deploy ya que Railway redeploya solo en push). Se añadió comentario
  explicativo.
- Se eliminó el step que seteaba `NIXPACKS_NO_CACHE` / `RAILPACK_NO_CACHE` (la
  mutación variableCollectionUpsert con esas vars), permitiendo cache de build
  normal. El step 2 ahora solo fija el startCommand a "node server.js".
- Token: se usa exclusivamente vía `env: RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}`
  y se lee con `os.environ['RAILWAY_TOKEN']`. NO hay ningún `echo`/print del token.
  Los `print()` solo muestran nombres de proyecto/servicio y resultados de la API
  (que no incluyen el token).

Validación:
- Indentación YAML correcta (revisada). `grep` por NIXPACKS/RAILPACK_NO_CACHE: sin
  coincidencias. Sin exposición de token en logs.

## Tarea 5 — Dockerfile hardening
Estado: ARREGLADO (verificado)
Archivo: /home/user/jabenoitv/Dockerfile (líneas 13-15)

Cambios:
- Añadido `RUN chown -R node:node /app` y `USER node` antes del CMD (corre como
  usuario no-root `node`).
- `npm install` se mantiene (NO se cambió a `npm ci`): no existe package-lock.json
  en el repo (verificado con `ls`), por lo que `npm ci` rompería el build.
- CMD se mantiene en exec form: `CMD ["node", "server.js"]` (SIGTERM correcto).
- COPY package*.json antes de npm install: cache de capas preservado.

Validación:
- `ls package-lock.json` -> no existe -> se conserva `npm install` (correcto).

## Tarea 6 — package.json (pinear versiones)
Estado: ARREGLADO (verificado)
Archivo: /home/user/jabenoitv/package.json (dependencies)

Cambio:
- `"moltlaunch": "latest"` -> `"moltlaunch": "^2.17.0"`.
  La versión instalada en node_modules/moltlaunch es exactamente 2.17.0
  (verificado), así que el rango es seguro y reproducible.
- `"cashclaw-agent": "^0.1.0"` ya estaba pineado razonablemente; instalado: 0.1.0.
  Se deja como está.

Validación:
- `node -e "JSON.parse(...)"` -> package.json OK (JSON válido).
- Versiones instaladas: moltlaunch=2.17.0, cashclaw-agent=0.1.0.

## Tarea 7 — Crear .env.example
Estado: ARREGLADO (verificado)
Archivo: /home/user/jabenoitv/.env.example (creado)

Contenido: todas las vars conocidas con placeholders y comentarios de
requerido/secreto:
- PORT (opcional, default 3777)
- WALLET_ADDRESS (requerido), WALLET_PRIVATE_KEY (requerido, SECRETO)
- ANTHROPIC_API_KEY (requerido, SECRETO)
- AGENT_ID (opcional, default 51049)
- NEYNAR_API_KEY (SECRETO, req. Farcaster), FARCASTER_SIGNER_UUID (SECRETO)
- DASHBOARD_SECRET (SECRETO, recomendado)
- BOUNTY_AUTOPOST (opcional, default DRY-RUN)
- GIGS_SETUP_DONE (opcional), PUBLIC_URL (opcional)
Sin valores reales, solo placeholders.

## Tarea 8 — .gitignore
Estado: ARREGLADO / NO-APLICA (ya correcto)
Archivo: /home/user/jabenoitv/.gitignore

Verificación: `.env` y `local-setup.sh` YA están listados (junto con node_modules/
y *.local). No fue necesario modificar. Confirmado que local-setup.sh no aparece
como trackeado en `git ls-files`.

---

## SECRETOS ENCONTRADOS Y LIMPIADOS — ROTAR ESTOS YA

1. Railway API token (estaba hardcodeado en railway.html):
   - Prefijo: `8d85c544-...`
   - Acción: ROTAR el token de Railway de inmediato (Railway Dashboard > Account >
     Tokens). Además estuvo expuesto a proxies CORS de terceros si se usó la página.

2. Wallet private key (estaba/podía estar en local-setup.sh, archivo en disco no
   versionado):
   - Prefijo esperado: `0x68e3...` (según auditoría). Ya reemplazado por
     `${WALLET_PRIVATE_KEY}`.
   - Acción: ROTAR/migrar fondos a una wallet nueva si la llave estuvo en disco/se
     compartió.

3. Anthropic API key (estaba/podía estar en local-setup.sh):
   - Prefijo: `sk-ant-...`
   - Acción: REVOCAR y regenerar en console.anthropic.com.

Nota: railway.html SÍ está/estuvo en el árbol de trabajo del repo; el token de
Railway debe considerarse comprometido. local-setup.sh está gitignored, pero si su
contenido con secretos existió en disco o se compartió, rota igualmente.

## Validaciones globales ejecutadas
- railway.json: JSON válido (node JSON.parse OK).
- package.json: JSON válido (node JSON.parse OK).
- railway.html: sin tokens/UUID/sk-ant restantes (grep limpio).
- local-setup.sh: sin claves 0x.../sk-ant... (grep limpio).
- redeploy-railway.yml: sin NIXPACKS/RAILPACK_NO_CACHE, sin echo de token, YAML
  con indentación correcta.
- Dockerfile: package-lock.json no existe -> npm install conservado; USER node y
  chown añadidos; CMD exec form intacto.
