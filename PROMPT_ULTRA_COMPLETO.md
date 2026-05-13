Usa este prompt en Cursor (nuevo chat) para que el agente haga TODO el trabajo pesado y deje memoria persistente con Obsidian MCP en Windows.

---

Actua como ingeniero senior de automatizacion. Quiero que tu hagas todo el trabajo pesado para configurar memoria persistente cross-device en Cursor usando Obsidian MCP y GitHub.

Objetivo (sin trabajo manual del usuario, excepto dar la URL del repo):
- Dejar memoria durable entre sesiones y entre maquinas.
- Separar memoria global y por proyecto.
- Auto-recuperar MCP si se cae.
- Auto-sync del vault a GitHub.

Contexto tecnico esperado:
- Windows.
- Vault local: `%USERPROFILE%\Documents\cursor-memory-vault`.
- MCP en Cursor debe quedar en `%USERPROFILE%\.cursor\mcp.json`.
- Cursor debe usar `mcp-remote` hacia `http://127.0.0.1:3001/sse`.
- Repo privado del vault: `<REPO_URL_PRIVADO>`

Reglas de implementacion (ejecuta tu todo esto):
1. Verifica prerequisitos (`git`, `node`, `npm`).
2. Si falta algo, instalalo si puedes hacerlo de forma segura; si no puedes, pide solo ese dato/accion puntual.
3. Crea/actualiza estructura minima del vault:
   - `MEMORY.md`
   - `SESSION_LOG.md`
   - `PROJECTS/TEMPLATE.md`
4. Configura `%USERPROFILE%\.cursor\mcp.json` con servidor `obsidian-memory` usando `mcp-remote`.
5. Asegura servidor MCP local (`@smith-and-web/obsidian-mcp-server`) en puerto `3001`.
6. Crea task scheduler watchdog (cada 5 min) para relanzar MCP si cae.
7. Crea task scheduler auto-sync git (cada 10 min), en modo oculto (sin ventana molesta).
8. Verifica health endpoint `http://127.0.0.1:3001/health` == 200.
9. Verifica tasks activas y ultimo resultado.
10. Dame un resumen final con:
   - que cambiaste,
   - que validaste,
   - pasos manuales restantes.

Reglas de memoria durante trabajo:
- Al iniciar tarea: leer `MEMORY.md` y `PROJECTS/NOMBRE_PROYECTO.md`.
- Durante tarea: guardar checkpoint cada 3-5 mensajes si hubo avance real.
- Al cerrar tarea: resumen breve en `SESSION_LOG.md`.
- Solo lo durable/global va a `MEMORY.md`.
- Nunca guardar secretos o credenciales.

Formato de salida que quiero:
1. "Estado actual"
2. "Cambios aplicados"
3. "Validaciones"
4. "Siguientes pasos"

Si algo falla, no te detengas al primer error:
- diagnostica causa,
- aplica fix,
- vuelve a validar,
- reporta claramente.

Importante:
- Minimiza preguntas al usuario.
- Solo pide datos imprescindibles (por ejemplo credenciales o autorizaciones).
- Si un paso puede automatizarse, automatizalo.
