# KNOWN_FAILURES

Lecciones estructuradas de fallos reales (formato ADR-0038: síntoma + causa raíz + fix,
recuperables por categoría/tag vía `vault_observations`).

## Build de webpack se queda sin memoria

- [failure] webpack build aborta con JavaScript heap out of memory en CI #webpack #build
- [root_cause] source maps completos + fork-ts-checker duplicando el AST en workers
- [fix] NODE_OPTIONS=--max-old-space-size=4096 y source-map solo en release

## Playwright no descarga el navegador tras el proxy

- [failure] playwright install se cuelga descargando chromium detrás del proxy corporativo #playwright #proxy
- [root_cause] la descarga ignora HTTPS_PROXY cuando PLAYWRIGHT_DOWNLOAD_HOST está vacío
- [fix] fijar PLAYWRIGHT_BROWSERS_PATH compartido y saltar la descarga en npm postinstall

## pnpm install falla con lockfile corrupto

- [failure] pnpm install rompe con ERR_PNPM_LOCKFILE_BREAKING_CHANGE tras cambiar de rama #pnpm
- [root_cause] lockfile v6 regenerado por una versión vieja de pnpm en otra máquina
- [fix] corepack enable + packageManager pinneado en package.json; borrar node_modules y relockear
