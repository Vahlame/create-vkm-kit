# Windows: sincronizar el vault con git (sin scripts del kit)

Esta guía **no** publica ni pide copiar `.ps1`, `.vbs` ni `.bat` desde el repo. Elige una de estas rutas.

## Opción A (recomendada): `obsidian-memoryd watch` (Go)

Sincronización **al guardar** con debounce (por defecto **45 s** tras el último cambio; ajusta con `OBSIDIAN_MEMORY_DEBOUNCE`). Requiere **Go**, compilar desde este repo y ejecutar el binario con `BASIC_MEMORY_HOME` apuntando al vault. Detalles: [`cmd/obsidian-memoryd`](../../cmd/obsidian-memoryd), `agent.toml`, y en Windows el binario puede compilarse con `go build -ldflags="-H windowsgui"` si lo registras en el Programador de tareas **como programa** (ruta al `.exe`), sin capas de script del kit.

## Opción B: solo git a mano

Abre una terminal en el vault y ejecuta cuando quieras converger con el remoto:

```bash
git status
git add -A
git commit -m "memory"   # solo si hay cambios
git pull --rebase
git push
```

Orden seguro: **add → commit (si aplica) → pull --rebase → push** ([ADR-0004](../adr/0004-sync-order-add-commit-pull-push.md)). Si haces `pull --rebase` con cambios sin stagear, Git responde _cannot pull with rebase: You have unstaged changes_.

## Opción C: memoria en el mismo repo que ya actualizas

Sin segundo temporizador solo para el vault: [`memory-repo-sin-automatismos-locales.md`](./memory-repo-sin-automatismos-locales.md).

## Programador de tareas (avanzado, por tu cuenta)

Si registras **tú** una tarea que lance `git` u otro binario, revisa en **Programador de tareas** (GUI) la línea de comando y el **código de salida** en el historial. Este repo no incluye plantillas de tarea con PowerShell/VBS para copiar.

## English

Same content: [`windows-scheduled-vault-sync.en.md`](./windows-scheduled-vault-sync.en.md).
