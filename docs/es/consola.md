> 🇪🇸 Español · [🇬🇧 English](../en/console.md)

# La consola — todo el kit en tiempo real

`vkm-console` es un binario Go que sirve **una página** en `127.0.0.1:4930` con el estado
vivo de todas las piezas: el daemon de sync, la memoria, el gasto de tokens, la actividad de
la proyección Postgres y los trabajos de research en segundo plano.

Sustituye a correr cuatro comandos en tres lenguajes y cruzar timestamps a mano.

**Es estrictamente de solo lectura.** No escribe en ninguna parte, no toma ningún lock y no
abre ningún handle de escritura — ver [ADR-0085](../adr/0085-vkm-console-realtime-binary.md).

---

## Construirlo

Desde un clon del kit:

```bash
npm run build:console
```

O directamente con el toolchain de Go (Go 1.25+), que es la vía que siempre funciona:

```bash
go build -o bin/vkm-console ./cmd/vkm-console          # Linux / macOS
go build -o bin/vkm-console.exe ./cmd/vkm-console      # Windows
```

No hace falta nada más: HTML, CSS y JS van **dentro** del binario vía `go:embed`, así que no
hay carpeta de assets que localizar ni CDN que consultar. La página funciona sin red.

Si lo instalaste con el flag del instalador:

```bash
npx @vkmikc/create-vkm-kit --full --console
```

---

## Ejecutarlo

```bash
vkm-console --vault "<RUTA_AL_VAULT>" --open
```

Imprime la URL (con token) y, con `--open`, abre el navegador. Sin `--open` solo escucha:

```text
vkm-console 5.5.2 listening on http://127.0.0.1:4930/?token=<token> (vault: …)
```

En Windows, acceso directo en el Escritorio:

```bash
node scripts/install-console-shortcut.mjs --vault "<RUTA_AL_VAULT>"
```

> ⚠️ **La URL impresa es la credencial.** El `?token=` es nuevo en cada arranque. Abrir
> solo `http://127.0.0.1:4930/` muestra la **página de acceso** (cómo lanzar con `--open`),
> no el dashboard. CSS/JS en `/static/*` no exigen token (sí exigen Host loopback); el
> documento y las APIs sí. Una visita con `?token=` válido deja además una cookie HttpOnly.

### La verja de autenticación

1. **Host loopback.** `Host` (sin puerto) = `127.0.0.1`, `::1` o `localhost`.
2. **Token de la ejecución** en `?token=`, cabecera `x-vkm-console-token` o cookie
   `vkm-console-token` — en documento y APIs (no en `/static/*` ni `/api/health`). Ausente →
   `403 forbidden`.

`GET /api/health` es la **única** ruta sin verja — devuelve `{"ok":true,"version":…}` y nada
más, justo para poder sondear "¿está viva?" sin repartir el token:

```bash
curl http://127.0.0.1:4930/api/health                       # sin token: 200
curl http://127.0.0.1:4930/api/snapshot                     # sin token: 403 forbidden
curl -H "x-vkm-console-token: <token>" http://127.0.0.1:4930/api/snapshot
```

Correrlo sin `--vault` es válido: la consola arranca igual y las tarjetas que necesitan un
vault se muestran como "apagadas".

---

## Flags y variables

| Flag / variable                   | Para qué                                                                   | Por defecto                                                 |
| --------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `--vault <ruta>`                  | Vault a observar.                                                          | `VKM_VAULT` → `BASIC_MEMORY_HOME` → `OBSIDIAN_MEMORY_VAULT` |
| `--port <n>` / `VKM_CONSOLE_PORT` | Puerto de escucha (siempre en `127.0.0.1`).                                | `4930`                                                      |
| `--open`                          | **Explícito**: abre el navegador en la URL. Sin este flag, nunca lo abre.  | apagado                                                     |
| `--refresh <segundos>`            | Cada cuánto se empuja un snapshot completo por el stream SSE (mínimo `1`). | `5`                                                         |

El puerto es **fijo** a propósito (los otros del kit: 8765 basic-memory, 4319 sink OTLP,
4923 GUI de vkm-spec). Una página que quieres marcar como favorita no puede cambiar de
puerto en cada arranque; el pg-service sí usa puerto dinámico porque nadie lo escribe a
mano.

Escucha **solo en loopback**. No hay flag de bind-address: exponer un lector completo de tus
notas a la red de casa no es una opción que deba existir.

---

## Los paneles

| Panel        | Qué muestra                                                                                             | De dónde lo lee                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Daemon**   | Edad del heartbeat, último push exitoso, commits sin empujar, rebases abortados, fallos consecutivos.   | El archivo de estado de `obsidian-memoryd`.                                         |
| **Memoria**  | Conteo de notas, notas por carpeta, notas tocadas más recientemente — y los agregados de la proyección. | Un recorrido de solo lectura de los `.md` del vault, y `/api/stats` + `/api/graph`. |
| **Tokens**   | Uso por día / modelo / tipo y ratio de acierto de caché.                                                | Los rollups NDJSON de `vkm-doctor` en `~/.vkm/telemetry/`.                          |
| **Postgres** | Backend, conteo de filas, último sync y el timeline de actividad de la proyección.                      | `/api/health`, `/api/timeline`, `/api/stats`, `/api/graph` del pg-service.          |
| **Research** | Búsquedas recientes de obscura y descargas.                                                             | El log de búsquedas de obscura y `~/Downloads/vkm-kit/`.                            |

Cada colector es **fail-soft**: una fuente ausente o rota devuelve un error legible y su
tarjeta se muestra "apagada" en vez de tumbar la página. El daemon, la proyección y obscura
son todos opcionales; en una instalación mínima verás una tarjeta viva y el resto apagadas.

**Frescura.** La página mantiene una conexión SSE contra el `/api/events` de la propia
consola. Ese stream trae un snapshot completo cada `--refresh` segundos (5 por defecto) **y
además** un push inmediato, con debounce de 2 s, cada vez que un único watcher `fsnotify`
sobre el vault, el directorio de telemetría y el data root de Postgres detecta un cambio. Si
el watcher no arranca, el refresco periódico sigue cubriéndolo todo.

---

## La garantía de no robar el foco

Esta es la propiedad que más se cuidó, porque el kit lleva tres releases quitando ventanas
que se ponían delante ([ADR-0078](../adr/0078-allocate-and-hide-a-console.md)):

- **Arrancar la consola no abre ninguna ventana.** Ni navegador, ni consola de Windows.
- **El navegador se abre solo si tú pasas `--open`**, en esa invocación concreta. No hay
  auto-open al arrancar, ni al reconectar, ni cuando un panel falla.
- Cuando `--open` sí abre el navegador, ese spawn pasa por el lanzador de consola oculta
  (`throughHiddenConsole()` / `windowsHide`) como cualquier otro spawn del kit.
- La consola es una **página web**, no una TUI, precisamente por esto: una TUI _es_ una
  ventana de consola, y en Windows eso significa o bien una ventana visible o bien una oculta que
  nadie puede ver.

Resultado práctico: puedes dejarla corriendo mientras juegas a pantalla completa — que es
exactamente la carga contra la que se midió ADR-0078.

---

## Solución de problemas

### El puerto 4930 está ocupado

```bash
VKM_CONSOLE_PORT=4931 vkm-console --vault "<RUTA>"
```

### El panel de Postgres dice "no está corriendo"

La proyección es opcional y arranca bajo demanda. Enciéndela (`VKM_PG=1`) y pide
`vault_pg_status` desde tu agente, o corre `vkm-pg-migrate` una vez — ver
[memoria en Postgres](memoria-postgres.md). La consola **no** arranca el servicio por su
cuenta: eso sería escribir, y no escribe.

### No veo la página desde otro equipo

Correcto: escucha en `127.0.0.1`. Usa un túnel SSH
(`ssh -L 4930:127.0.0.1:4930 tu-maquina`) si de verdad la necesitas desde otro sitio. Por el
túnel el `Host` sigue siendo loopback, así que la verja lo acepta — pero necesitas también el
`?token=` de esa ejecución.

### `403 forbidden` en todo menos `/api/health`

Falta el token o es de un arranque anterior. Vuelve a mirar la línea que imprimió la consola
y usa la URL entera (`http://127.0.0.1:4930/?token=…`) o manda la cabecera
`x-vkm-console-token`. Comprueba también que estás entrando por `127.0.0.1` / `localhost` y
no por el nombre de red de la máquina: un `Host` que no sea loopback se rechaza aunque el
token sea correcto.

### Cambié el CSS y no se ve

Los assets están embebidos con `go:embed`: hay que reconstruir el binario
(`npm run build:console`). Es el precio de que no exista una carpeta de assets que se pueda
perder.

---

## Más

- Decisión, alternativas descartadas y consecuencias: [ADR-0085](../adr/0085-vkm-console-realtime-binary.md).
- La regla de no robar el foco: [ADR-0078](../adr/0078-allocate-and-hide-a-console.md).
- La proyección que alimenta el panel de actividad: [memoria en Postgres](memoria-postgres.md).
- Las otras superficies de observabilidad: [observabilidad](observabilidad.md).
