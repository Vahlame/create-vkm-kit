> 🇪🇸 Español · [🇬🇧 English](../en/migration-5.0.md)

# Migrar de 4.x a 5.0

**Versión corta:** ejecuta el instalador una vez con las mismas flags de siempre y reinicia
todas las sesiones del editor. Tu vault, los ids de tus servidores MCP, tus variables de
entorno y tu `CLAUDE.md` quedan intactos a propósito — el
[ADR-0079](../adr/0079-naming-and-compatibility-tiers.md) los congela.

```bash
npx @vkmikc/create-vkm-kit@latest --full
```

Lee el [Paso 1](#paso-1-cierra-antes-todas-las-sesiones-del-editor) antes de ejecutarlo en
Windows. Ahí el orden importa, y solo ahí.

---

## Qué es la 5.0

Una release de refactor. Casi todo el cambio es interno: módulos compartidos donde antes
vivían seis copias, un instalador partido en piezas testeables, un daemon Go dividido por
responsabilidad, documentación cuyos números coinciden con el código. No se quitó ninguna
función del producto y nada cambia en cómo lo usas.

Tres cosas sí requieren acción, y una de ellas es el motivo para actualizar.

---

## Paso 1: cierra antes todas las sesiones del editor

**Esto aplica a Windows. En macOS y Linux, salta al [Paso 2](#paso-2-ejecuta-el-instalador).**

La 5.0 evita que aparezcan ventanas de consola mientras el agente trabaja — el parpadeo que
te sacaba de un juego o de una app a pantalla completa cada vez que corría un hook en segundo
plano o una llamada MCP. El arreglo enruta cada servidor MCP a través de
`vkm-runhidden.exe`, y el instalador tiene que **reemplazar ese archivo en disco**.

Windows no reemplaza un ejecutable en uso. Si hay una sesión de Claude Code, Cursor o Codex
abierta, sus servidores MCP mantienen `vkm-runhidden.exe` abierto, el reemplazo falla y
terminas con una instalación mixta: unos servidores lanzados de la forma nueva y otros de la
vieja — que sigue parpadeando, y parece que el arreglo no funcionó.

Entonces, en este orden:

1. **Cierra por completo todas las sesiones de editor y de agente.** No solo la ventana:
   revisa la bandeja del sistema y el Administrador de tareas por `node.exe` sueltos bajo tu
   editor.
2. Ejecuta el instalador (Paso 2).
3. Vuelve a abrir tu editor.

El instalador detecta un launcher bloqueado y te lo dice, en vez de reportar éxito sobre una
instalación a medias. Si ves ese aviso, cierra la sesión que nombra y vuelve a ejecutarlo.

## Paso 2: ejecuta el instalador

El mismo comando y las mismas flags de antes. Nada cambió en la CLI:

```bash
npx @vkmikc/create-vkm-kit@latest --full
```

Si instalaste un subconjunto, conserva tu subconjunto — las flags son las mismas
(`--obscura`, `--downloads`, `--doctor`, `--skills` y las demás).

## Paso 3: verifica

```bash
npx @vkmikc/create-vkm-kit@latest --check-update
```

Luego abre una sesión y confirma dos cosas:

- Tu memoria sigue ahí. Haz `vault_hybrid_search` de algo que sepas que está en el vault.
- No aparece ninguna ventana de consola mientras el agente ejecuta una herramienta. En
  Windows este es el cambio por el que actualizaste; si todavía parpadea, casi seguro tenías
  una sesión abierta durante el Paso 2 — vuelve al Paso 1.

---

## Qué NO cambió

A propósito, y de forma permanente para la 5.x. Cada uno de estos vive en un archivo que
este kit no controla, así que renombrarlo sería una rotura silenciosa que ningún instalador
podría reparar ([ADR-0079](../adr/0079-naming-and-compatibility-tiers.md)):

| Tipo                               | Se queda exactamente igual                                               |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Paquete npm y comandos             | `@vkmikc/create-vkm-kit`, `create-vkm-kit`, `vkm`                        |
| Ids de servidores MCP en tu config | `basic-memory`, `obsidian-memory-hybrid`, `obscura-web`, `vkm-downloads` |
| Nombres de tools en tu `CLAUDE.md` | `mcp__obsidian-memory-hybrid__*`                                         |
| Entorno                            | `BASIC_MEMORY_HOME` y todas las variables `OBSIDIAN_MEMORY_*`            |
| Ruta por defecto del vault         | `~/Documents/obsidian-memory-vault`                                      |
| Subcomandos de la CLI de Python    | todos menos `bench` (abajo)                                              |
| El daemon y su servicio            | `obsidian-memoryd`                                                       |

Tu vault es Markdown plano en git y la 5.0 no toca su formato. No hace falta reindexar.
(`vault_fts_index({ semantic: true })` sigue valiendo la pena tras una importación grande,
exactamente como antes — eso tampoco cambió.)

---

## Cambios que rompen

Cuatro, y tres de ellos solo pueden alcanzarte si manejabas el tooling propio del repo en
vez de usar el kit.

### 1. Se eliminó `obsidian-memory-rag bench`

Usa `bench-recall`. Es el comando que CI ya usaba.

```bash
# antes
obsidian-memory-rag bench --corpus <dir> --queries <file>

# ahora
obsidian-memory-rag bench-recall --corpus <dir> --queries <file> --assert-p95-ms 400
```

`bench` cronometraba búsquedas repetidas sin ground truth, así que podía reportar un motor
rápido que devolvía las notas equivocadas. `bench-recall` reporta p50/p95/media por consulta
**y** recall, y puede fallar un build por cualquiera de los dos. Nada invocaba a `bench`: ni
CI, ni el puente MCP, ni un test.

### 2. Los runners de evals cambiaron su contrato de streams

Solo te afecta si scripteas `evals/*/run.mjs`. En los seis benches, **stdout ahora son filas
JSONL y stderr es el reporte legible**. Cinco de los seis ya lo hacían así;
`token-quality-ab` hacía lo contrario y ahora coincide. Si redirigías un bench a un archivo
para guardar el resumen, añade `2>&1`:

```bash
node evals/token-quality-ab/run.mjs --mechanism compact-tool-output --models a,b 2>&1 | tee results.txt
```

`discipline-bench` además lista sus condiciones con el tratamiento primero (`discipline`,
luego `stock`), de modo que su Δ reportado usa la misma convención de signo que los demás
benches. Los valores de `condition` por respuesta no cambian; solo el orden y el signo del
delta.

### 3. Se borró `docs/assets/bench-results-dark.svg`

Los gráficos claro y oscuro eran idénticos byte a byte salvo por siete valores hex.
`bench-results.svg` ahora se adapta al tema por sí solo. Si enlazabas el archivo oscuro,
apunta a `bench-results.svg`; si usabas un `<picture>` para alternarlos, un `<img>` simple
hace lo correcto en ambos temas.

### 4. Se movió el histórico del changelog

Las entradas de la 3.15.0 y anteriores están en
[`docs/changelog/pre-4.0.md`](../changelog/pre-4.0.md). Cubren releases de
`@vkmikc/create-obsidian-memory`, un nombre de npm obsoleto y congelado desde la 4.0.0. No
se editó nada: las secciones y sus definiciones de enlace se movieron literales.

También se movió: `docs/observability.md` ahora es `docs/en/observability.md`, para que viva
con el resto de páginas en inglés y el selector de idioma de su espejo en español apunte a
algún sitio con sentido.

---

## Si algo se ve mal

- **Sigue parpadeando una consola en Windows.** Había una sesión abierta durante la
  instalación. Cierra todo (incluidos los procesos en bandeja), vuelve a ejecutar el
  instalador y reabre. Ver Paso 1.
- **Un servidor MCP no arranca.** Comprueba que tu entrada en `mcp.json` siga nombrando el
  mismo id — la 5.0 no renombró ninguno, así que un id distinto se cambió localmente.
- **La búsqueda no devuelve nada.** Confirma que `BASIC_MEMORY_HOME` apunta a tu vault. La
  ruta por defecto no cambió, así que esto solo muerde si la habías puesto en un sitio
  propio y perdiste el ajuste.
- **Cualquier otra cosa.** `vkm-doctor` reporta uso local y salud de la caché, y
  [`docs/es/troubleshooting.md`](troubleshooting.md) cubre el resto.

## Ver también

- [Qué trae la 4.0](./migracion-4.0.md) — si vienes de la 3.x, haz esa actualización primero.
- [ADR-0078](../adr/0078-allocate-and-hide-a-console.md) — por qué ocultar una consola es
  mejor que negarla, y por qué el arreglo obvio empeora el problema.
- [ADR-0079](../adr/0079-naming-and-compatibility-tiers.md) — qué nombres pueden cambiar.
