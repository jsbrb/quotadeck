# QuotaDeck Desktop — bandeja + flyout pineable

Objetivo: app nativa de Windows (Tauri 2) que muestra las cuotas de QuotaDeck
sin navegador: ícono de bandeja que colorea por umbral (el "badge") y flyout
frameless con las cards; un pin lo convierte en mini-ventana siempre visible.
Branch: `feature/desktop-tray-app` (worktree `quotadeck-worktrees/desktop-tray`,
base `origin/develop` @ 2066ec8). Delivery: ask-on-risk. Test runner: vitest
(hermético) + `cargo check` para el shell Rust.

## Specs

- S1: La app funciona **sin el navegador abierto** — verbatim: «sin la
  necesidad de estar abierto en el navegador».
- S2: Superficie acordada en conversación: «bandeja + flyout pineable» —
  ícono de bandeja junto al reloj; clic lo abre/cierra (flyout se oculta al
  perder foco); botón pin lo fija como mini-ventana always-on-top sin lugar
  en la taskbar (no aparece en alt-tab). El usuario tenía dudas entre
  «la opcion 1 y la opcion 3» y aceptó el combo.
- S3: Anti-conflicto con hito-13 — verbatim: «quiero que abramos una rama
  desde develop que no entre en conflicto con el otro agente». Regla: esta
  rama NO edita ningún archivo bajo `extension/`; el código compartido se
  importa por path (`@shared/*` → `../extension/src/*`).
- S4: Reuso del pipeline aceptado: providers, refresh engine, error taxonomy
  y snapshot store desde `extension/src` (ya desacoplados de `chrome.*`
  detrás de `platform/browser-api.ts`).
- S5: Credenciales en **Windows Credential Manager** (no en archivos planos);
  equivalente desktop del invariant de `qd:key:{providerId}` en
  `chrome.storage.local`.
- S6: Refresh cada 60s (equivalente del alarm `usage-refresh`); el ícono de
  bandeja colorea según umbral del provider elegido (misma paleta que el
  badge: slate <50%, naranja 50%, deep-orange 80%, rojo 90%).
- S7: Distribución (GitHub Releases / winget / firma) queda POST primer build
  funcional — decisión postergada explícitamente.
- (Supuesto marcado como supuesto: Tauri 2 con WebView2 presente en el
  Windows 11 del usuario; se valida en el primer `tauri dev`.)
- S8: Solo se muestran providers con clave — verbatim: «no se deben mostrar
  proveedores que yo no he puesto keys... Solo deberían salir aquellos que
  yo he colocado una key. ¿Para qué? Para ahorrar espacio».
- S9: Tira horizontal acoplada — verbatim: «La ventana tiene que quedar
  ajustada al lateral de la pantalla y abajo pegado a la barra de tareas» y
  «en lugar de que crezca como columna, que crezca como fila a lo horizontal.
  Horizontal pegado a la barra de tareas... Para que no interrumpa
  visualmente la pantalla del programador». KEYS tab: ventana transitoria
  más alta (aprobado en conversación: «vamos con ello» a la propuesta 4).
- S10: Barra estilo segunda taskbar — verbatim: «las cards tienen que ser
  minimalistas, porque lo que quiero es como que hay una segunda barra de
  tareas... Solo hace falta que ponga proveedor, porcentaje y cuándo se
  resetea. información mínima. y por supuesto no puede haber toolbars, es
  decir, el tamaño tiene que ser establecido». Crecer según claves
  (confirmado: opción «Crecer según claves»).

## Tasks

| ID | S# | Tarea | Route | Estado |
|----|----|----|----|----|
| T1 | S2,S3,S6 | Scaffold `desktop/`: Tauri 2 (tray + ventana frameless `skipTaskbar` + hide-on-blur + comando `set_pinned`), vite + tsconfig + alias `@shared`, íconos generados desde `extension/public/icons` | inline | ✅ hecho — e5927fb (tsc+vite build ✅, cargo check ✅ 1m08s; @types/node agregado al scaffold) |
| T2 | S4,S5 | Adaptador de plataforma desktop: storage port (JSON en `%APPDATA%` para preferencias) + key store sobre Credential Manager; scheduler 60s (movido a T3) | inline | ✅ hecho — commit WU-B (cargo check ✅, tsc ✅, vitest 5/5 ✅) |
| T3 | S4 | Wiring del refresh engine + providers desde `@shared`; render del snapshot en el flyout con el diseño Neo-Brutalist; scheduler de 60s (absorbe el scope movido de T2); transporte sin CORS vía tauri-plugin-http con allowlist de los 7 hosts | inline | ✅ hecho — commit WU-C (tsc ✅, vitest 9/9 ✅, vite build 34.6kB ✅, cargo check ✅) |
| T4 | S2,S6 | Ícono de bandeja coloreado por umbral (5 PNGs de paleta) + posicionado del flyout junto al reloj | inline | ✅ hecho — commit WU-E (4 íconos de banda generados; flyout se ancla al rect real del ícono; tsc ✅, vitest 17/17 ✅, cargo check ✅) |
| T5 | S1 | Tests: vitest para adaptadores herméticos; `cargo check`/`clippy` del shell; smoke `tauri dev` | inline | parcial: 9 tests herméticos ya corren; smoke con claves reales pendiente |
| T6 | S1,S4 | UI de claves en el flyout (ZAI token, Qwen AK/SK + plan key, selector badge provider) con display enmascarado vía `readMaskedCredential` — equivalente desktop del tab KEYS | inline | ✅ hecho — commit WU-D (tsc ✅, vitest 13/13 con DOM sweep ✅, build ✅) |
| T7 | S8,S9 | Strip UX: render solo-keyed + tira horizontal dockeada (work_area real), ancho dinámico vía `reflow_flyout`, KEYS transitoria más alta | inline | ✅ hecho — commit WU-F (tsc ✅, vitest 21/21 ✅, cargo check ✅) |
| T8 | S2,S9,S10 | Rediseño barra taskbar: segmentos minimalistas (nombre, %, countdown reset), sin chrome de ventana, controles en menú de bandeja (Keys…/Always on top/Quit), estética oscura, KEYS ventana aparte desde el menú | inline | ✅ hecho — commit WU-G (vitest 23/23 ✅) |
| T9 | S1,S5 | FIX root cause + blindaje tick: keyring `windows-native` (mock silencioso sin feature), steps de qwen try/catch, `qd:last-tick-error` persistido. Pipeline verificado E2E con credencial dummy (dispatch → classify → snapshot) | inline | ✅ hecho — commit WU-G (E2E live ✅) |
| T10 | S10 | Segmentos de dos líneas: reset debajo de nombre+%; barra 68px (feedback smoke: «saliese debajo de... un pelín más alta») | inline | ✅ hecho — commit WU-H (tsc ✅, vitest 23/23 ✅) |
| T11 | S8,S10 | Stored-key segments: providers con clave guardada SIEMPRE visibles (muted `NO DATA THIS TICK` si el step omite — contrato hito-12); sin selector de badge (tray fijo a ZAI); instrumentación temporal removida | inline | ✅ hecho — commit WU-I (tsc ✅, vitest 24/24 ✅) |
| T12 | S4 | Diagnóstico qwen gateway: captura de console.error + body crudo del gateway en prefs. HALLAZGO: mint OK (acs3 + RAM policy bien); el gateway responde 200 **text/html** — página de bloqueo detail-exception de Taobao (securitySDK, Tengine/Swift). UA/Accept/Accept-Language/HTTP2/gzip/cookies NO lo evitan | inline | ✅ diagnóstico hecho — commit WIP |
| T13 | S4 | Qwen gateway: **login embebido** (decisión del usuario sobre cookie-paste y degradación honesta) — webview con el console real, cookies de sesión leídas nativamente y adjuntas al gateway; expiración → segmento `SESSION EXPIRED — SIGN IN`. Riesgo spike: verificar API `cookies_for_url` en Tauri 2.12 PRIMERO; plan B = desafío acw en webview | inline | pendiente (próxima sesión) |
| T14 | S4 | Sync develop: hito-13 (DeepSeek) **aún no aterrizó** en origin/develop — y develop fue REESCRITO (hashes nuevos, mismos mensajes). Re-check del fetch al retomar; merge origin/develop → nuestra rama cuando aterrice; luego host de DeepSeek a la allowlist desktop | inline | pendiente (bloqueado por el merge externo) |
| T15 | S10 | Uniformidad de segmentos: con dato real, qwen/deepseek usan la plantilla exacta de ZAI; revisar CSS restante | inline | pendiente |

## Log

- L1 (2026-10-25, verbatim): «Pero realmente sería útil como algo visible en
  la barra de inicio. Como por ejemplo hay plugins en Mac, en iOS, que sí que
  los ves en la barra de abajo… ¿Qué se podría hacer para eso? para hacer esa
  adaptación a Windows.»
- Decisión: Tauri 2 elegido sobre Electron (usuario: «Instalar rustup →
  Tauri»); rustup 1.99.1 instalado vía winget; VS 2022 Build Tools C++
  ya presentes.
- Decisión: monorepo con import por path; la extracción formal a `core/`
  queda para POST-merge de hito-13 (evita conflicto con DeepSeek provider).
- Prohibido en esta rama: editar `extension/`, `docs/spike/endpoints.md`,
  specs de openspec existentes. Archivos nuevos bajo `desktop/` y este doc.
- 2026-10-25 — T1 (WU-A) completado en `e5927fb`: shell Tauri 2.12.5 con
  bandeja (menú Quit, toggle con clic izquierdo), flyout frameless
  skipTaskbar anclado arriba de la taskbar, hide-on-blur cuando no está
  pineado, comando `set_pinned` (alwaysOnTop) ya conectado al botón PIN del
  frontend. Verificación observada: `tsc --noEmit` + `vite build` ✅,
  `cargo check` ✅. Pendiente de smoke real: `npx tauri dev` (T5) — la
  interacción de bandeja no es verificable sin GUI. Limpieza: `tauri icon`
  genera assets iOS/Android; se eliminaron (desktop-only).
- 2026-10-25 — Gotcha de smoke (fix incluido): un `cargo build` pelado
  produce un binario que carga el dev server (`localhost:5173` →
  ERR_CONNECTION_REFUSED en el webview). La feature `custom-protocol`
  (declarada ahora en Cargo.toml) embebe los assets de `frontendDist`.
  Smoke observado: ícono de bandeja ✅, flyout abre con clic izquierdo ✅
  (confirmado por el usuario); re-verificación de contenido embebido tras el
  fix en curso. Nota: al relanzar dos veces llegaron a correr 2 instancias
  — considerar `tauri-plugin-single-instance` en T2.
- 2026-10-25 — WU-A CERRADO tras fix `custom-protocol` (`f82a200`): smoke
  completo CONFIRMADO por el usuario — bandeja visible, flyout con UI
  embebida, hide-on-blur, PIN/UNPIN always-on-top, menú Quit. Procesos de
  prueba eliminados (0 huérfanos). Verificación: tsc ✅, vite build ✅,
  cargo check ✅, smoke GUI ✅.
- 2026-10-25 — T2 (WU-B): dos áreas StorageArea sobre `src/lib/desktop-storage.ts`
  (prefs → JSON en app data dir vía `prefs.rs`; secretos → UNA entrada
  `quotadeck-desktop/secrets` en Credential Manager vía `secrets.rs`, blob
  JSON completo — evita el cap de 2560B por entrada y da semántica KV exacta).
  `tauri-plugin-single-instance` agregado (segunda instancia enfoca el
  flyout existente). Scheduler 60s movido a T3 (pertenece al wiring del
  engine). Scope-move decidido por el agente, sin cambio de S#.
- 2026-10-25 — T3 (WU-C): loop desktop propio (`refresh-loop.ts`) en vez de
  importar background.ts — su guard `typeof chrome !== 'undefined'` es TRUE
  en WebView2 (window.chrome existe) y crashearía el import; las piezas
  (engine, client, steps, stores) son chrome-free y el tick/query/merges son
  gemelas pinneadas de background. Transporte: `FetchTransport` de la
  extensión con `FetchImpl` sobre tauri-plugin-http (reqwest, sin CORS) bajo
  allowlist de exactamente los 7 hosts de los providers shipeados; el Origin
  del gateway qwen se inyecta directo en el fetch (reqwest lo permite) con la
  constante pública `QWEN_GATEWAY_TRUSTED_ORIGIN` — contraparte desktop de la
  regla DNR. Render compacto reusando `badgeBackgroundColor/TextColor` de
  `@shared/core/usage` (bandas imposibles de driftar). tsconfig desktop:
  `noUnusedLocals/Parameters` off — el typecheck compila fuentes de
  extension/ vía @shared y no deben policializarse con flags que su propio
  tsconfig no aplica; `@types/chrome` dev-only para el import type-only de
  `dnr/gateway-origin-rule` → `platform/browser-api` (runtime nunca lo
  carga). Smoke con credenciales reales pendiente (T5, tras T6 keys UI).
- 2026-10-25 — T7 (WU-F, feedback de smoke del usuario): render keyed-only
  (S8: itera `snapshot.results`, que por contrato solo tiene providers con
  clave; empty state = una card «NO KEYS YET»). Tira horizontal dockeada
  (S9): anchor_flyout usa `Monitor::work_area()` (sin estimados de taskbar),
  clic de bandeja muestra el dock fijo abajo-derecha (se eliminó el
  anchor-near-tray), `reflow_flyout` hace setSize+re-dock en un paso con
  ancho determinista = PAD + count×190 + gaps (sin medición DOM, sin loop de
  feedback). KEYS = ventana transitoria 680×560 con grid de 2 columnas.
  `tauri.conf.json` boot 700×170. Verificado: tsc, vitest 21/21, vite build,
  cargo check. Smoke visual pendiente de confirmación del usuario.
- 2026-10-25 — S10 añadido (feedback smoke): la barra debe verse como una
  SEGUNDA barra de tareas — verbatim: «las cards tienen que ser
  minimalistas... como que hay una segunda barra de tareas... Solo hace
  falta que ponga proveedor, porcentaje y cuándo se resetea... no puede
  haber toolbar, es decir, el tamaño tiene que ser establecido».
- 2026-10-25 — T8+T9 (WU-G): barra rediseñada como strip oscuro de 52px sin
  chrome; segmentos `NOMBRE · % · RESETS Xd Yh`; controles al menú de
  bandeja (Keys… abre ventana 680×560, Always on top = CheckMenuItem,
  Quit); clic izquierdo muestra la barra (evento `quotadeck://show-bar`).
  ROOT CAUSE del TICK FAILED / claves perdidas: `keyring = "3"` sin
  features compila un MOCK en memoria — saves a la nada, lecturas NoEntry.
  Fix: `features = ["windows-native"]`. Blindaje: plan/quota steps con
  try/catch (degradan a error del provider, no tumban el tick) y
  `qd:last-tick-error` persistido + mostrado en la barra. Pipeline E2E
  verificado con credencial dummy vía CredWrite P/Invoke (cmdkey escribe
  blobs vacíos en shell no-interactiva — artifact documentado en Log):
  keyring leyó 33 bytes → dispatch → clasificación `server` → snapshot ✅.
  tsc ✅, vitest 23/23 ✅, cargo ✅.
- 2026-10-26 — T12: instrumentado en vivo (captura console.error + body del
  gateway en `qd:console-log`). Secuencia probada: mint acs3 ✅ (token
  obtenido, RAM policy correcta) → gateway POST → **200 text/html** (1980
  bytes, página detail-exception de Taobao: securitySDK, aplus, Tengine,
  x-cache Swift). Probado sin éxito: UA del webview, Accept, Accept-Language,
  tauri-plugin-http features http2+gzip+cookies. El usuario confirma que la
  extensión Chrome SÍ muestra qwen HOY → el WAF distingue el stack del
  navegador real (TLS/h2 fingerprint y/o cookies de sesión del console).
  Decisión del usuario: **login embebido** (spike WU-K, próxima sesión).
  Instrumentación temporal todavía en el árbol (capturedErrors/
  capturedResponses/qd:console-log) — remover al cerrar WU-K.
- ESTADO AL CORTAR: app corriendo con build diagnóstico (ZAI datos reales
  20%, qwen NO DATA — WAF). Prefs del usuario en
  %APPDATA%\es.thenorthcode.quotadeck.desktop\. 9 commits en la rama
  (WU-A..I + docs); desarrolla en worktree, extension/ intocada.
