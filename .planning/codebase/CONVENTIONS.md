# Code Conventions

## Module System

- CommonJS throughout: `require()` for all imports, no ES module `import` syntax.
- No transpilation step — Node.js runs `server.js` directly via `node server.js`.

## Variable Declarations

- `const` for values that never change (port calculations, paths, module imports, constants like `PRICE_FLOOR`/`PRICE_CEIL`, `MAX_LOGS`, `MAX_JOBS`).
- `let` for mutable module-level state (`ethPrice`, `marketData`, `cashclawProc`, `cashclawStatus`, `restartCount`, `totalEarnedEth`, etc.).
- `var` is used **only inside the `<script>` block** embedded in `DASHBOARD_HTML` (browser-side code). All server-side code uses `const`/`let` exclusively.

## Naming Conventions

- **camelCase** for all functions (`fetchEthPrice`, `fetchMarketPrices`, `addLog`, `detectJobEvent`, `startCashclaw`, `broadcast`).
- **camelCase** for variables and object keys (`cashclawProc`, `sseClients`, `totalEarnedEth`, `restartCount`).
- **UPPER_SNAKE_CASE** for true constants: `PRICE_FLOOR`, `PRICE_CEIL`, `MAX_LOGS`, `MAX_JOBS`, `PORT`, `CASHCLAW_PORT`, `AGENT_ID`, `DASHBOARD_HTML`.
- Abbreviations are acceptable in browser script helpers (`fmt`, `ftime`, `fdate`, `fdur`, `fN`, `fEth`, `fUsd`, `fClp`) — brevity is intentional there.

## String Literals

- **Single quotes** for all server-side string literals (require paths, log messages, JSON keys in code, etc.).
- **Template literals (backtick strings)** are used at the server level in exactly one place: building the `DASHBOARD_HTML` string. They are used there to interpolate `${AGENT_ID}` into the static HTML/CSS.
- **CRITICAL CONSTRAINT**: No backtick template literals may appear inside the `<script>` ... `<\/script>` section within `DASHBOARD_HTML`. The script block is a JavaScript string value that Node.js writes verbatim to the browser; backticks inside it would be valid browser JS, but they create ambiguity and have historically caused bugs during editing. All string building inside that script block uses **single-quote concatenation** (e.g., `'data: ' + JSON.stringify(obj) + '\n\n'`, `h+'h '+m+'m'`).
- Double quotes appear only inside JSON literals and HTML attribute values.

## Arrow Functions vs Named Functions

- Named function declarations (`function foo() {}`) are used for all top-level server logic that needs hoisting or is referenced before its definition: `broadcast`, `fetchEthPrice`, `fetchMarketPrices`, `addLog`, `detectJobEvent`, `startCashclaw`.
- Arrow functions (`=>`) appear in callbacks and event handlers: `.on('data', d => ...)`, `.on('end', () => ...)`, `.on('error', e => ...)`, `req.on('close', () => ...)`, `server.listen(PORT, '0.0.0.0', () => ...)`.
- Inside `DASHBOARD_HTML` script block, both named functions and `function` expressions are used (no arrow functions) for maximum compatibility with older browser engines.

## Error Handling

- All async I/O errors (HTTP requests, file reads/writes) are caught and logged with `console.log` rather than `console.error`, using Spanish-language messages (e.g., `'Error precio ETH:'`, `'No se pudo parchear cashclaw:'`).
- `try/catch` blocks wrap JSON parsing and file operations; on error, execution continues (fail-silent strategy for non-critical paths).
- The server itself uses `console.error` for fatal errors and calls `process.exit(1)` on `server.on('error', ...)`.
- Browser-side `try/catch` blocks in the script silently swallow errors (empty catch bodies `catch(e){}`), which is intentional for resilience in the dashboard.
- The cashclaw subprocess auto-restarts on exit via `setTimeout(startCashclaw, 15000)`.

## Logging Patterns

- All logging goes to `console.log` (stdout) or `console.stderr.write` for subprocess pipe passthrough.
- Log messages are in **Spanish** (matching the project's language): `'Precio ETH: $'`, `'Mercado escaneado:'`, `'CashClaw salio (codigo ...) reiniciando en 15s'`, `'Dashboard listo en ...'`.
- Structured log entries stored in the `logs` array have the shape `{ time: ISO string, msg: string, type: 'info'|'error'|'warn' }`.
- The `logs` ring buffer caps at `MAX_LOGS = 500` entries (oldest entry shifted out when full).

## HTTP / API Patterns

- Raw `http.createServer` — no Express or framework.
- Routes are matched with simple `if (url === '/path')` checks after stripping query strings.
- All JSON API endpoints set `'Access-Control-Allow-Origin': '*'`.
- Responses use `res.writeHead` + `res.end` (not `res.json`).
- SSE endpoint (`/events`) uses `res.write` for streaming; clients are tracked in the `sseClients` array and cleaned up on `req.on('close', ...)`.

## Spread / Object Literals

- Object spread (`{ ...marketData }`) is used when broadcasting market data to avoid coupling the broadcast payload to the stored object reference.

## File Patching Pattern

- The cashclaw dist file is patched at startup by reading the file, doing `String.replace`, and writing it back. This is guarded in a `try/catch` and only executes if the target string is still present (idempotent guard: `if (src.includes(...))`).

## General Style

- Compact, minimal code — no unnecessary blank lines or comments beyond section dividers (`// SSE clients`, `// ETH price`, etc.).
- Section comments use Spanish (`// Inteligencia de mercado`, `// Estado del agente`).
- No linter config, no Prettier config — formatting is manual and consistent with the patterns above.
