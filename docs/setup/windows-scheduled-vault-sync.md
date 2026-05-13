# Windows: sincronizar el vault con git (sin scripts del kit)

Esta guía **no** publica ni pide copiar `.ps1`, `.vbs` ni `.bat` desde el repo. Elige una de estas rutas.

## Opción A (recomendada): `obsidian-memoryd watch` (Go)

Sincronización **al guardar** con debounce (por defecto **45 s** tras el último cambio; ajusta con `OBSIDIAN_MEMORY_DEBOUNCE`).

**Sin ventanas en Windows:** el repo compila el binario con dos archivos de plataforma:
- `proc_windows.go` — cada subproceso `git` recibe `CREATE_NO_WINDOW + HideWindow: true`; cero consolas, incluso cuando el `.exe` es subsistema GUI (`-H windowsgui`).
- `proc_other.go` — no-op en Linux/macOS.

Comando de compilación para Windows (sin consola):
```bash
go build -ldflags="-H windowsgui" -o bin/obsidian-memoryd.exe ./cmd/obsidian-memoryd
```

Arranque silencioso: **acceso directo en Inicio** apuntando al `.exe`, argumentos `watch`, **Iniciar en** = raíz del vault. No envuelvas en `cmd.exe`. Ajusta la frecuencia: `setx OBSIDIAN_MEMORY_DEBOUNCE 2m`.

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
