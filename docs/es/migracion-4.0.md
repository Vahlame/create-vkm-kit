> 🇪🇸 Español · [🇬🇧 English](../en/migration-4.0.md)

# Migración a 4.0 (el kit ahora se llama vkm-kit)

En 4.0.0 el kit pasa de llamarse `obsidian-memory-kit` a **vkm-kit**: una suite de eficiencia
para Claude Code — memoria persistente en vault + token-saver + doctor de uso local +
spec-builder. Cambia la **marca** (repo, npm, bins, docs); **no cambia nada de lo que tus
instalaciones dependen**. El porqué y el detalle técnico: ADR-0041 y ADR-0050 en
[`docs/adr/`](../adr/).

## Qué cambió

| Antes                                           | Ahora                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Repo `github.com/Vahlame/obsidian-memory-kit`   | `github.com/Vahlame/create-vkm-kit` (la URL antigua redirige)                                           |
| npm `@vkmikc/create-obsidian-memory`            | `@vkmikc/create-vkm-kit` (el nombre antiguo sigue funcionando como shim)                                |
| Bin `create-obsidian-memory`                    | Bins `create-vkm-kit` y el alias corto `vkm`                                                            |
| Carpeta `packages/create-obsidian-memory/`      | `packages/create-vkm-kit/`                                                                              |
| Marcadores `<!-- obsidian-memory:start/end -->` | `<!-- vkm-kit:start/end -->` (el bloque 3.x se migra **in place**: uno solo tras actualizar, nunca dos) |

Las variables `VKM_*` (p. ej. `VKM_VAULT`) se leen primero, con fallback a los nombres legados —
tu configuración existente sigue valiendo tal cual.

## Qué NO cambia (congelado a propósito)

Estos identificadores viven en estado duradero de tus instalaciones (permisos, servicios,
scripts) y **nunca se renombran** — tus entradas de `permissions.allow` y tus registros MCP
siguen funcionando sin tocar nada:

- La clave del servidor MCP **`obsidian-memory-hybrid`** (y los nombres de tools
  `mcp__obsidian-memory-hybrid__*`).
- El daemon **`obsidian-memoryd`** (los servicios del SO lo referencian por nombre).
- Las variables **`BASIC_MEMORY_HOME`** (contrato de basic-memory, no de este kit) y
  **`OBSIDIAN_MEMORY_*`** (siguen aceptadas).
- El paquete Python **`obsidian-memory-rag`** y el npm **`@vkmikc/obsidian-memory-mcp`**.
- El archivo de regla **`.cursor/rules/obsidian-memory.mdc`**.
- El vault por defecto **`~/Documents/obsidian-memory-vault`**.

## Cómo actualizar

Un solo comando:

```bash
npx @vkmikc/create-vkm-kit --full
```

Reconoce lo instalado por 3.x y lo **migra in place**: reescribe el bloque gestionado con los
marcadores nuevos (sin duplicarlo), reconcilia los hooks y conserva tu configuración. Si tienes
scripts fijados al nombre antiguo, `npx @vkmikc/create-obsidian-memory` sigue funcionando: es un
shim que reenvía al paquete nuevo (deprecado con aviso, nunca retirado). Después, reinicia
Claude Code / Codex (o recarga la ventana de Cursor) para que la sesión nueva vea los cambios.

## Novedades de 4.0.0, en un párrafo

El **token-saver** compacta la salida ruidosa de las tools antes de que entre al contexto —
≥30% de reducción sin perder ni una línea de diagnóstico, con kill switch `VKM_TOKEN_SAVER=0` —;
**`vkm-doctor`** añade un sink OTLP local (127.0.0.1:4319) y un informe de tokens/coste/caché
**que nunca sale de tu máquina**; **`assemble_context`** devuelve en **una** llamada presupuestada
el contexto de proyecto que antes costaba 3–6 búsquedas encadenadas (mediana −68% de tokens de
wire, gate en CI); **`vkm-spec`** convierte una idea de una línea en una spec XML anclada al vault
(GUI en `127.0.0.1:4923`, borrador opcional con Ollama `phi4-mini` y fallback determinista que
siempre funciona); y las skills **`/vkm-discipline`** y **`/vkm-spec`** llevan esa disciplina a la
sesión de Claude Code.

## Desinstalar

```bash
npx @vkmikc/create-vkm-kit --uninstall          # añade --dry-run para previsualizar
```

Revierte todo lo que el kit instaló (hooks, bloque gestionado, skills, telemetría) y está
**protegido por hash**: los archivos que tú modificaste a mano se detectan y **no** se borran.
