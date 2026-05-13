Siempre que este disponible el servidor MCP `obsidian-memory`, sigue este flujo:

1. Al iniciar una tarea:
   - leer `MEMORY.md`
   - detectar proyecto actual
   - usar o crear `PROJECTS/<proyecto>.md`

2. Durante la tarea:
   - registrar decisiones por proyecto
   - checkpoint cada 3-5 mensajes si hubo avance real
   - no guardar secretos

3. Al cerrar tarea:
   - append en `SESSION_LOG.md` con fecha, proyecto y decision
   - mover a `MEMORY.md` solo lo durable/global

4. Reglas de calidad:
   - no escribir por escribir
   - evitar duplicados
   - separar hechos de hipotesis
