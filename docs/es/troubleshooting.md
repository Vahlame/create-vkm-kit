> 🇪🇸 Español · [🇬🇧 English](../en/troubleshooting.md)

# Solución de problemas

Una referencia tranquila y paso a paso para arreglar problemas del **kit v3**
(la conexión `basic-memory`, la búsqueda híbrida opcional y el servidor HTTP
opcional siempre encendido). Cada entrada tiene la misma forma: el **síntoma**
que ves, la **Causa** y la **Solución** exacta que debes escribir.

Algunos términos que aparecerán una y otra vez:

- **MCP** (Model Context Protocol): el puente que permite al agente de IA dentro
  de Cursor leer y escribir archivos en tu vault Markdown.
- **stdio**: la forma más simple de ejecutar ese puente — Cursor lanza un
  programita cuando hace falta. Sin servidor de fondo, sin puerto abierto.
- **Streamable HTTP** (`url`): la alternativa — un servidor que dejas
  encendido, y Cursor le habla por un puerto de red dentro de tu propia máquina.
- **PATH**: la lista de carpetas donde Windows busca cuando escribes el nombre
  de un comando. Si una herramienta "no se reconoce", casi siempre le falta
  estar en el PATH.

Si aún estás configurando, mira la guía de instalación
([`instalacion.md`](./instalacion.md)) y la de sincronización
([`sincronizacion.md`](./sincronizacion.md)). Las dudas frecuentes están en las
[preguntas frecuentes](./faq.md).

## Contenido

- [MCP / Cursor](#mcp--cursor)
- [Git](#git)
- [Tareas programadas de Windows](#tareas-programadas-de-windows)
- [PowerShell](#powershell)
- [Red y puertos](#red-y-puertos)
- [Recuperación](#recuperación)

---

## MCP / Cursor

Estos son los problemas que aparecen cuando el agente de IA no logra llegar a tu
vault, o cuando Cursor abre ventanas de consola sueltas.

### `uv` / `uvx` no se reconoce (Windows)

**Causa.** `basic-memory` arranca con el comando `uvx basic-memory mcp`, pero
**uv** no está instalado, o está instalado pero no en tu PATH. (`uv` es una
herramienta pequeña que descarga y ejecuta programas de Python; `uvx` es su
lanzador de "ejecútalo una vez").

**Solución.** Instala uv siguiendo las instrucciones oficiales:
[instalación de uv](https://docs.astral.sh/uv/getting-started/installation/).
Luego cierra y vuelve a abrir la terminal (o Cursor) para que el nuevo PATH
tenga efecto, y confirma que funciona:

```powershell
uv --version
```

### `create-obsidian-memory` muestra `Invalid JSON in mcp.json` aunque el archivo se ve bien

**Causa.** Algunos editores (y `Set-Content -Encoding utf8` en versiones
antiguas de PowerShell) escriben una marca invisible llamada **BOM de UTF-8** al
inicio mismo de `mcp.json`. El lector de JSON (`JSON.parse`) rechaza ese byte
inicial aunque todo lo demás sea válido.

**Solución.** Desde `@vahlame/create-obsidian-memory` **2.0.0-beta.2** (actual:
**beta.3**), el inicializador elimina automáticamente un BOM inicial antes de
fusionar. Vuelve a ejecutar la fusión no interactiva, o quita el BOM a mano:
vuelve a guardar el archivo como **UTF-8 sin BOM**, o borra el primer carácter
invisible de arriba.

### Panel MCP de Cursor: `basic-memory` aparece en rojo / "no disponible"

Este tiene varias causas posibles. Recórrelas de arriba abajo.

| Causa                                                                                                                                                          | Solución                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Falta `uv` / `uvx`** en el PATH que usa Cursor, o la primera descarga en frío de `uvx` aún está corriendo (**20–40 s** la primera vez).                      | Instala uv, reinicia Cursor y espera una vez. Mira [`uv` / `uvx` no se reconoce](#uv--uvx-no-se-reconoce-windows) arriba.      |
| **`BASIC_MEMORY_HOME`** apunta a una carpeta que no existe o no se puede leer. (`BASIC_MEMORY_HOME` es la variable que le dice al puente dónde vive tu vault). | Pon una ruta **absoluta** a la raíz de tu vault en `mcp.json`, y vuelve a fusionar una entrada conocida buena (comando abajo). |
| Usas **`url`** (Streamable HTTP) pero nada está escuchando en ese puerto.                                                                                      | Arranca el listener (mira la guía de sincronización) **o** cambia a **stdio** (`command` + `uvx`).                             |

Para volver a fusionar una entrada `basic-memory` conocida buena, reemplazando
`<path>` por la ruta completa a tu vault:

```powershell
npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "<path>"
```

### `mcp.json` perdió mis entradas de Linear / Supabase

**Causa.** Una ejecución de configuración anterior **sobrescribió** el archivo
en vez de **fusionar** dentro de él. (Fusionar conserva tus entradas existentes
y solo agrega o actualiza las del propio kit).

**Solución.** Restaura desde la copia de seguridad automática `mcp.json.bak`. El
inicializador actual (`create-obsidian-memory`) siempre hace esa copia primero y
fusiona; solo guiones mucho más antiguos de la era v1 podían pisar el archivo.
Mira la sección [Recuperación](#recuperación) para el reseteo completo.

### Log de Cursor: `Transient error connecting to streamableHttp server: fetch failed`

**Causa.** `mcp.json` usa una **`url`** (Streamable HTTP) para `basic-memory`,
pero **nada válido está escuchando** en ese host y puerto. O el listener no se
arrancó, o se cayó, o **otro programa no relacionado ya ocupó el puerto** — en
ese último caso la conexión de red "tiene éxito" pero la petición MCP igual
falla.

**Solución.** Arranca el listener HTTP como lo configuraste (mira la guía de
sincronización). Por ejemplo, una **terminal minimizada** ejecutando:

```powershell
uvx basic-memory mcp --transport streamable-http
```

Confirma que el listener es de verdad **basic-memory** y no otro programa. Lista
quién ocupa el puerto (`8765` es el predeterminado) y luego revisa ese proceso:

```powershell
netstat -ano | findstr :8765
```

Eso imprime un **PID** (el número que identifica al proceso). Busca el nombre del
programa de ese PID en el Administrador de tareas. Si el puerto predeterminado
está tomado por otra cosa, elige un puerto alto libre (por ejemplo **8877**) y
pon el **mismo** valor en **ambos**: el comando del listener **y** `mcp.json`:

```json
"url": "http://127.0.0.1:8877/mcp"
```

Si en realidad no necesitas un servidor permanente, vuelve a **stdio**
(`command` + `uvx`).

> **`ECONNREFUSED` justo después de editar `mcp.json`.** Cursor puede intentar
> reconectar **antes** de que termine el primer arranque en frío de `uvx` (puede
> tardar **20–40 s**). Espera, arranca el listener y luego ejecuta **Developer:
> Reload Window** desde la paleta de comandos de Cursor.

### Cursor: `basic-memory` en rojo con la URL `http://127.0.0.1:…/mcp`

**Causa.** El servidor HTTP de `basic-memory` no está levantado, o el **puerto
está ocupado por otra app** (la capa de red puede "abrir" mientras MCP igual
falla con `fetch failed`).

**Solución.** Arranca el listener HTTP como en la guía de sincronización (una
terminal minimizada, o una tarea que **tú** definiste). Comprueba que el PID que
ocupa el puerto corresponde a `basic-memory` / `uv`:

```powershell
netstat -ano | findstr :8765
```

Si el puerto predeterminado está tomado, elige otro (por ejemplo **8877**) y usa
el **mismo** valor en el comando de arranque y en `mcp.json`.

### Aviso: `Failed to open resource: memory://...`

**Causa.** Cursor intentó abrir contenido **nativo / virtual de "memory"** (el
esquema `memory://`), no un archivo real de tu vault Markdown. El enlace
probablemente está obsoleto, o ese recurso ya no existe.

**Solución.** Cierra la notificación. Si sigue apareciendo, ejecuta **Developer:
Reload Window**. Para abrir notas del vault, usa las herramientas MCP
(`read_note`, `write_note`, etc.). Esto **no** lo causa la autosincronización de
git por sí sola.

### Parpadea una consola grande al sincronizar o al arrancar el MCP

**Causa.** El binario de `obsidian-memoryd` se compiló como app de **consola**
(sin el flag `-H windowsgui`), o sus subprocesos `git` no llevan el flag
`CREATE_NO_WINDOW` (esto es comportamiento pre-v3).

**Solución (kit v3).** Compílalo como app sin ventana:

```bash
go build -ldflags="-H windowsgui" -o bin/obsidian-memoryd.exe ./cmd/obsidian-memoryd
```

El repo incluye `proc_windows.go`, que añade `CREATE_NO_WINDOW + HideWindow` a
cada subproceso `git`, eliminando el parpadeo incluso al lanzarse desde un
ejecutable windowsgui. Mira la guía de sincronización para más detalle.

### Muchas ventanas de CMD / una consola negra al abrir Cursor o al refrescar MCP

**Causa (frecuente).** Cursor lanza procesos MCP definidos con **`command`** (por
ejemplo **`node`** para `obsidian-memory-hybrid`, o **`uvx`** / **`npx`**) en
cada conexión o **reintento**; en Windows eso puede mostrar brevemente una
ventana de consola.

**Causa (HTTP `basic-memory`).** Tras un cambio de configuración o un reinicio,
Cursor puede intentar conectar **antes** de que el listener exista, registrando
`ECONNREFUSED`; los reintentos encadenan más arranques de MCP con consola.

**Solución.** Arranca el listener HTTP y espera **20–40 s** la primera vez
(`uvx` descarga en su primer uso), luego ejecuta **Developer: Reload Window**.
Para **menos ventanas**, desactiva los MCP que no uses, o ejecuta
**`basic-memory` por stdio**.

**Para diagnosticar,** abre **Administrador de tareas → Detalles** (activa la
columna de línea de comando) o **Monitor de recursos** mientras ocurre el
problema, para ver exactamente qué programa abre las ventanas.

### Cada pocos segundos aparece `conhost` y su padre es `git` (Windows)

**Prevención (kit).** Este repo y el vault de ejemplo incluyen un
**`.vscode/settings.json`** que desactiva `git.autorefresh` / `git.autofetch` y
excluye carpetas del **watcher** de archivos (incluido `.obsidian/`). Cursor /
VS Code aplican esos valores cuando abres la carpeta como workspace. El
inicializador **`@vahlame/create-obsidian-memory`** **crea o fusiona**
`<vault>/.vscode/settings.json` cuando pasas `--vault` (las claves de Git/SCM del
kit se actualizan; cualquier otra clave tuya se conserva).

**Causa.** Algo — casi siempre el **control de código fuente del IDE** o una
extensión como **GitLens** — ejecuta **`git.exe`** en bucle (`status`, diffs,
etc.). En Windows muchas de esas llamadas crean un **`conhost.exe`** como hijo de
**`git`**. Ver **decenas** de ventanas `conhost` suele significar que hay
**muchas ventanas del IDE abiertas**, **muchas carpetas abiertas a la vez**, o
procesos que no se cierran bien.

**Solución.** Abre el repo / vault como **carpeta raíz** para que cargue
`.vscode/settings.json`. Si ya tienes tu propio `settings.json`, copia las claves
`git.*` y `files.watcherExclude` del ejemplo del kit. Revisa extensiones Git
pesadas y **cierra** ventanas duplicadas que apunten al mismo repo.

### Ventana emergente con título `git.exe` o `…\Git\bin\sh.exe` que roba el foco

**Causa.** Algo (el control de código fuente de Cursor, una extensión o una
tarea) está lanzando **`…\Git\bin\git.exe`** o **`bin\sh.exe`** en una **consola
aparte**. Eso es típico de Git for Windows cuando se usa el ejecutable de git
equivocado en vez del **`cmd\git.exe`** pensado para programas con interfaz
gráfica.

**Solución.** En **Settings → JSON** (de usuario o de workspace), apunta Git al
ejecutable correcto y desactiva la autenticación por terminal:

```json
"git.path": "C:\\Program Files\\Git\\cmd\\git.exe",
"git.terminalAuthentication": false
```

Ajusta la ruta si tu Git es portable o está en otro disco — encuéntrala con:

```powershell
where.exe git
```

El kit **fusiona** ambas claves cuando ejecutas `create-obsidian-memory` con
`--vault` en Windows, siempre que encuentre `cmd\git.exe`. Después, ejecuta
**Developer: Reload Window**.

> El **código 0 o 1** que muestra el mensaje de "proceso terminado" es un
> detalle secundario; el problema real es la **ventana** que quita el foco a tu
> juego o editor.

### `npx -y mcp-remote` va muy lento la primera vez

**Causa.** La caché de `npx` está vacía, así que la primera instalación en frío
tarda unos **30 segundos**. (`npx` ejecuta paquetes de Node; la primera vez los
descarga).

**Solución.** Espera una vez. Cada llamada posterior es casi instantánea.

---

## Git

Estos cubren los errores de `git` que puedes ver al sincronizar el vault. El
orden seguro para sincronizar siempre es: `git add -A` → commit (solo si hace
falta) → `git pull --rebase` → `git push`.

### `cannot pull with rebase: You have unstaged changes`

**Causa.** Algo ejecutó `git pull --rebase` mientras la carpeta de trabajo aún
tenía **cambios sin preparar** (ediciones que a Git todavía no se le ha dicho que
incluya). El orden seguro es `git add -A` → commit (solo si hace falta) →
`pull --rebase` → `push`. Un `git pull --rebase` manual, o una automatización, se
saltó los pasos de add/commit.

**Solución.** Sigue el orden canónico: `add -A` → `commit` → `pull --rebase` →
`push`. Mira la guía de sincronización.

### `Author identity unknown`

**Causa.** Git no tiene configurados `user.name` ni `user.email`, así que no
puede firmar tus commits.

**Solución.** Configúralos una vez (reemplaza con tu propio nombre y correo):

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Ejecútalo antes de tu primer commit en cualquier vault o máquina nueva.

### `git ls-remote <url>` se queda colgado pidiendo credenciales

**Causa.** No hay un **Git Credential Manager** (GCM) que proporcione tu inicio
de sesión. Los instaladores modernos de Git for Windows incluyen GCM por
defecto, pero instalaciones antiguas o personalizadas pueden omitirlo.

**Solución.** Reinstala Git for Windows con la opción de GCM activada, o ejecuta
el comando de abajo, que configura GCM por ti:

```powershell
gh auth login
```

### `Repository not found` desde `ls-remote`

**Causa.** La URL del repositorio está mal, el repositorio no existe, o tu cuenta
no tiene acceso a él.

**Solución.** Abre la URL en tu navegador con la sesión iniciada para confirmar
que es correcta. Si la dirección está mal, inspecciona y corrige el remoto
`origin`:

```powershell
git remote -v
git remote set-url origin <url-correcta>
```

### `error: failed to push some refs to ...` tras un `pull --rebase` exitoso

**Causa.** Dos máquinas hicieron push casi al mismo tiempo (una "carrera" de
push).

**Solución.** Si usas el Programador de tareas para git, espera a la siguiente
ejecución o sincroniza a mano. Si no, haz un pull nuevo y luego push desde la
terminal integrada:

```powershell
git pull
git push
```

Mira la guía de sincronización para la opción de sincronización programada.

---

## Tareas programadas de Windows

Esta sección aplica **solo si elegiste** ejecutar una tarea programada de Windows
(para sincronizar git o para un servidor HTTP siempre encendido). Con
`basic-memory` por **stdio** simple no necesitas nada de esto.

> **Nota sobre plantillas para copiar y pegar.** Las guías actuales del kit **no**
> publican plantillas `schtasks` listas. Prefiere `basic-memory` por **stdio**
> más **git manual** o **`obsidian-memoryd watch`**.

### `ERROR: The system cannot find the file specified` tras `schtasks /Create`

**Causa.** Un problema de comillas en el argumento `/TR` (el comando que ejecuta
la tarea), o la ruta del programa dentro de la tarea no existe.

**Solución.** Envuelve el argumento `/TR` en comillas dobles e invócalo a través
de `cmd /c` para que PowerShell no vuelva a interpretar las comillas internas.
Luego revisa la línea de comando en **Programador de tareas → tu tarea →
Acciones**.

### Aparece una ventana de consola cada pocos minutos (cadencia de la tarea programada)

**Causa.** La tarea ejecuta **`powershell.exe`** o **`cmd.exe`** de una forma que
muestra una ventana en cada ejecución.

**Solución.** Edita la tarea en `taskschd.msc` — elige un programa distinto,
sopesa "ejecutar tanto si el usuario inició sesión como si no" frente a la opción
interactiva, o desactiva la tarea. Mejor aún, prefiere `basic-memory` por
**stdio** con **git manual** o **`obsidian-memoryd watch`** en vez de un shell
programado a medida. Si la tarea aún se ejecuta demasiado seguido, aumenta su
intervalo.

### Una tarea programada muestra un "último resultado" distinto de cero

**Causa.** La acción de la tarea falló — credenciales de Git incorrectas, un
conflicto de fusión, una ruta equivocada, o el servidor HTTP MCP aún no estaba
levantado. (Un "último resultado" distinto de `0` significa que el comando
terminó con error).

**Solución.** Abre **Programador de tareas → tu tarea → Historial**, o ejecuta a
mano en una terminal la línea de comando que aparece en **Acciones** para ver el
error real. Para las opciones de sincronización de git y de `basic-memory` por
HTTP, mira la guía de sincronización.

---

## PowerShell

Windows trae de fábrica **Windows PowerShell 5.1** (`powershell.exe`). Varias
funciones modernas solo existen en **PowerShell 7+** (`pwsh`), que es una
instalación aparte — por eso los guiones que deben correr en todas partes tienen
que evitarlas.

### `El token '&&' no es un separador de instrucciones válido en esta versión`

**Causa.** PowerShell 5.1 no admite `&&` ni `||` como separadores entre comandos.
Solo PowerShell 7+ lo hace.

**Solución.** Encadena comandos con `;` y comprueba `$?` (¿tuvo éxito el último
comando?) o `$LASTEXITCODE` (el código de salida del último programa) después de
cada uno:

```powershell
git add -A; if (-not $?) { throw "git add failed" }
git commit -m "x"; if ($LASTEXITCODE -ne 0) { throw "commit failed" }
```

### `ConvertFrom-Json: A parameter cannot be found that matches parameter name 'AsHashtable'`

**Causa.** La opción `-AsHashtable` existe solo en PowerShell 7+. Los guiones
heredados y los ayudantes de CI también deben funcionar en 5.1, donde no está
disponible.

**Solución.** Usa `ConvertFrom-Json` a secas, y aplica `[pscustomobject]` en el
punto donde construyes la salida. Mira ADR-0005 para el patrón canónico.

### `The variable 'X' cannot be retrieved because it has not been set`

**Causa.** `Set-StrictMode -Version Latest` está activo (un modo que hace a
PowerShell más estricto), e intentaste leer una propiedad que no existe en un
`[pscustomobject]`.

**Solución.** Recorre las propiedades del objeto con `$obj.PSObject.Properties`
en vez de leerlas por nombre con punto, o dale a la propiedad un valor inicial
antes de leerla.

### `the term 'pwsh' is not recognized`

**Causa.** PowerShell 7 (`pwsh`) no está instalado. La CI y los guiones heredados
apuntan a Windows PowerShell 5.1 — el `powershell.exe` que ya viene con Windows.
Algunos usuarios ven esto al ejecutar el guion extractor de CI sin PS7.

**Solución.** Para la instalación en sí **no** necesitas `pwsh`. Para la CI
local, instala PowerShell 7:

```powershell
winget install --id Microsoft.PowerShell
```

---

## Red y puertos

### `obsidian-memoryd` muestra push/pull fallando estando sin conexión

**Causa.** No hay red disponible, así que la sincronización de git con rebote (la
sincronización de fondo que espera a los momentos de calma) no puede llegar al
remoto.

**Solución.** No hace falta nada — reintenta en el siguiente ciclo cuando la red
vuelve. Comprueba su salud en cualquier momento con:

```powershell
obsidian-memoryd doctor
```

Eso reporta la antigüedad del latido (heartbeat), el último push exitoso, y el
número de fallos consecutivos.

---

## Recuperación

Si tu instalación está en un estado confuso, reséteala en este orden. **Ninguno
de estos pasos borra tus notas** — tus archivos Markdown viven en git, y nada de
aquí elimina contenido del vault salvo que tú mismo borres carpetas.

1. **Configuración MCP.** Haz copia de seguridad del archivo, luego vuelve a
   fusionar una entrada `basic-memory` conocida buena (reemplaza
   `<absolute-vault-path>` por la ruta completa de tu vault):

   ```powershell
   npx @vahlame/create-obsidian-memory@next -- --non-interactive --vault "<absolute-vault-path>"
   ```

   El archivo del que hacer copia primero es `%USERPROFILE%\.cursor\mcp.json`.
   Esto restaura una entrada `basic-memory` funcional. Mira la
   [guía de instalación](./instalacion.md).

2. **Ruido de Git en el workspace (Windows).** Asegúrate de abrir el vault como
   **carpeta** para que `vault/.vscode/settings.json` tenga efecto, luego vuelve
   a ejecutar el mismo comando para fusionar las claves del kit.

3. **Comprobaciones manuales.** Ejecuta las comprobaciones de humo de MCP del
   documento de comprobaciones manuales del proyecto para confirmar que el agente
   llega al vault.

4. **Tareas de Windows / listener HTTP opcionales.** Solo si elegiste esas
   opciones, sigue la guía de sincronización. **No** son necesarias para
   `basic-memory` por stdio.

5. **Reset local duro (Windows).** Haz copia de seguridad de
   `%USERPROFILE%\.cursor\mcp.json`, luego en `taskschd.msc` borra o desactiva las
   tareas `Cursor*` que ya no quieras, y vuelve a fusionar MCP con el comando del
   paso 1. **No** borres el vault salvo que tú lo decidas.

> Tus archivos Markdown permanecen en **git**. Nada de esta sección borra
> contenido del vault salvo que elimines carpetas explícitamente o ejecutes un
> guion destructivo que tú mismo decidiste correr.

---

Ver también: [guía de instalación](./instalacion.md) ·
[guía de sincronización](./sincronizacion.md) · [preguntas frecuentes](./faq.md).
