---
type: failure
tags: [technical, curated]
status: active
updated: 2026-09-15
---

# KNOWN FAILURES (curado técnico)

Solo bugs **verificados** con fix reproducible. Sin preferencias personales ni datos sensibles.
Archivo histórico completo → `.trash/cleanup-2026-09-15/`.

## SQLite: `PRAGMA journal_mode=WAL` ignora `busy_timeout`

- [failure] `sqlite3.OperationalError: database is locked` en transición a WAL con concurrencia (CI intermitente, `assembleContext` abre varios procesos rag en paralelo). #sqlite
- [root_cause] La transición a WAL toma lock EXCLUSIVE que no consulta el busy handler — `busy_timeout` no aplica a esa sentencia.
- [fix] Retry acotado (backoff 5ms→100ms, techo 30s) alrededor de la transición; `busy_timeout` ANTES de cualquier sentencia que tome lock.

## Git: `.gitignore` sin anclar traga código fuente

- [failure] Archivos existen en disco y compilan local, pero `git ls-files` devuelve vacío en clone limpio. #git
- [root_cause] Patrón sin `/` inicial matchea a cualquier profundidad (`packages/` ignora `Packages/` con `ignorecase=true`).
- [fix] Anclar al root: `/packages/` + allowlist explícita. Verificar: `git ls-files --others --ignored --exclude-standard -- src tests` debe salir vacío.

## Git: allowlist por nombre de archivo deja huérfanos

- [failure] `git add -A` salta archivos nuevos en silencio; CI falla con archivo ausente. #git #gitignore
- [root_cause] `build/*` + `!build/publish.ps1` — solo un nombre literal permitido; el siguiente script en la misma carpeta nace ignorado.
- [fix] Patrón, no otro nombre: `!build/*.ps1`. Re-auditar tras **cada** archivo nuevo en directorios ignorados.

## Windows: guard `import.meta.url` en scripts Node

- [failure] Script sale exit 0 sin ejecutar `main()` — parece validar OK. #node #windows
- [root_cause] `import.meta.url === \`file://${process.argv[1]}\`` — backslashes vs forward-slash en Windows.
- [fix] `import.meta.url === pathToFileURL(process.argv[1]).href`. Grepear el patrón roto en todo el repo al cerrar el bug.

## CI: job cancelado por fail-fast ≠ fallo real

- [failure] Matriz roja en 3 OS; solo una pata falló, las otras canceladas sin ejecutar tests. #ci
- [fix] Leer logs de **cada** job; "The operation was canceled" con 0 fallos = víctima de fail-fast. Confirmar con re-run antes de tocar código.

## CI: job saltado reporta verde

- [failure] Release crea GitHub Release pero npm nunca publica; workflow reporta éxito. #ci #npm
- [root_cause] `if:` que salta el job; guard dentro del job saltado nunca corre.
- [fix] Guard **fuera** del job que puede saltarse; `workflow_call` desde release para exigir tests en el ref liberado.

## lychee: HTTP/2 protocol error en URLs que responden 200

- [failure] `Network error: HTTP/2 protocol error` en github.com con 128 requests concurrentes. #lychee #ci
- [fix] `--max-concurrency 32 --max-retries 4 --retry-wait-time 2` en lychee-action.

## Go: fijar transitiva al mínimo del advisory degrada la directa

- [failure] `go get x/crypto@v0.35.0` degradó `go-git` de v5.19.1 a v5.14.0. #go #seguridad
- [root_cause] MVS fuerza hacia abajo directas que exigen versión más nueva.
- [fix] Bumpear deps **directas** afectadas; dejar transitivas flotar. Re-correr scanner y comparar conteo.

## obscura: deadline interno no corta trabajo en vuelo

- [failure] Pipeline supera deadline global porque items en vuelo corren hasta su propio timeout. #obscura
- [fix] `Promise.race` contra tiempo real restante al tomar cada item; pasar `{deadline, now}` a **todos** los `mapWithConcurrency`.

## NPM publish: secret vacío en GitHub Actions

- [failure] `NPM_TOKEN not set` aunque `gh secret list` muestra el nombre. #npm #ci
- [root_cause] Secret puede existir con valor vacío; `NODE_AUTH_TOKEN: ` en blanco en log = cadena vacía.
- [fix] Re-ingresar por web de GitHub; verificar packument en registry, no solo check verde.
