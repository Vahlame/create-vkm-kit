---
type: project
created: 2026-03-02
tags: [node, fastify, postgres, helpdesk]
---

# ticket-hub

Mesa de ayuda multicanal para tres marcas de retail. API Node 22 + Fastify,
Postgres 16 particionado, worker de colas propio y widget embebible en las
tiendas online. En produccion desde mayo con 60 agentes concurrentes y unos
4000 tickets diarios entre correo, chat web y WhatsApp.

## Arquitectura

- Monolito modular: `api/` expone REST + un websocket de presencia de agentes;
  `worker/` procesa colas (correos salientes, webhooks, adjuntos, SLA).
- Cada canal (correo, chat web, WhatsApp) entra por un adaptador que normaliza
  el mensaje a un evento interno unico antes de tocar la base de datos.
- Los tickets viven en una tabla particionada por mes; las consultas siempre
  entran por `(marca_id, estado)` y el archivado mueve particiones enteras a
  almacenamiento frio una vez por trimestre.
- Sesiones de agente con JWT de acceso corto (10 min) + refresh token
  rotatorio en cookie httpOnly; la rotacion invalida la familia entera si se
  reusa un refresh viejo.

## Decisiones

- [decision] Colas sobre Postgres con SELECT FOR UPDATE SKIP LOCKED, no Redis: un solo motor que operar y 4k trabajos/dia no justifican otra pieza #colas
- [decision] Los webhooks entrantes se persisten crudos en `webhook_inbox` antes de procesarse; reproducir un evento es un UPDATE, no una disculpa al cliente #webhooks
- [decision] Idempotencia de webhooks por `event_id` del proveedor con indice unico; el reintento del proveedor es la norma, no la excepcion #webhooks
- [decision] Adjuntos en S3 con URL prefirmadas de 5 minutos y descarga solo via API; el bucket jamas es publico #adjuntos
- [decision] Busqueda de tickets con tsvector espanol + indice GIN; se evaluo un motor externo y se descarto por costo operativo para tres marcas #busqueda
- [decision] El SLA por marca se calcula en el worker cada minuto y se cachea; calcularlo por request duplicaba el p95 del listado de tickets #sla

## Gotchas

- [gotcha] La firma del webhook de WhatsApp usa el secreto del ENDPOINT, no el de la app; en staging son secretos distintos y cruzarlos da 401 intermitente #webhooks
- [gotcha] Fastify serializa con schemas: un campo nuevo sin declarar en el schema de respuesta desaparece del JSON en silencio y parece bug de datos #fastify
- [gotcha] El antivirus de adjuntos tarda hasta 20 segundos con PDFs grandes; responder 202 y avisar por websocket, nunca escanear en linea #adjuntos
- [gotcha] SKIP LOCKED necesita ORDER BY estable o dos workers toman lotes intercalados y el hilo de correos de un ticket llega desordenado #colas

## Webhooks entrantes

- Endpoint unico por proveedor (`/webhooks/whatsapp`, `/webhooks/email`) que
  verifica la firma HMAC contra el secreto del endpoint y responde 200 de
  inmediato; el procesamiento real ocurre en el worker leyendo `webhook_inbox`.
- Los reintentos del proveedor llegan hasta 72 horas despues; sin la tabla de
  idempotencia el mismo mensaje de WhatsApp creo tres tickets duplicados en la
  semana de lanzamiento.
- Cada fila del inbox guarda payload crudo, firma, cabeceras y el resultado
  del procesamiento; la reproduccion de un evento historico es marcar la fila
  como pendiente otra vez.
- Un webhook que falla tres veces pasa a una cola muerta revisada por alarma
  diaria; el error mas comun fue un adaptador que no toleraba emojis en el
  nombre del contacto.

## Colas y reintentos

- Cada trabajo es una fila en `jobs` con `run_at`, `attempts` y `locked_by`;
  los workers hacen polling cada segundo con SKIP LOCKED y lote de 20.
- Backoff exponencial 5s/25s/125s con jitter; sin jitter, un corte del
  proveedor de correo sincronizo todos los reintentos y el pico tumbo el pool
  de conexiones.
- Los correos salientes se agrupan por ticket en ventanas de 30 segundos: sin
  agrupar, una conversacion agil generaba seis notificaciones al cliente en un
  minuto y las quejas eran constantes.
- El worker publica su latido en una tabla `worker_heartbeat`; un latido viejo
  dispara la alerta de guardia antes de que la cola crezca visible.

## Adjuntos

- Limite de 25 MB por archivo y 10 archivos por ticket; el widget valida antes
  de subir y la API vuelve a validar (el widget es codigo del cliente, no una
  frontera de confianza).
- Todo adjunto pasa por antivirus en el worker; mientras esta en cuarentena el
  agente ve un placeholder gris con el estado del escaneo.
- Las URL prefirmadas expiran en hora del servidor: un desfase de reloj de 3
  minutos en un pod genero 403 intermitentes muy dificiles de reproducir.
- Los adjuntos de tickets archivados se mueven a una clase de almacenamiento
  fria; recuperarlos tarda minutos y la UI lo avisa en vez de colgar.

## Observabilidad

- Logs estructurados JSON con `pino` y un request-id propagado desde el proxy
  hasta el worker; buscar por request-id reconstruye la traza completa de un
  ticket sin herramientas extra.
- Metricas RED por endpoint + una metrica de negocio: tickets resueltos por
  hora y por marca, que fue la que detecto el adaptador de WhatsApp caido
  antes que ningun error tecnico.
- Alertas con dos umbrales: aviso al canal del equipo y critico que busca a la
  persona de guardia; una sola lista de guardia con rotacion semanal.

## Rendimiento medido

- p95 del listado principal de tickets: 110 ms tras el indice compuesto
  `(marca_id, estado, actualizado_en)`; antes 1.8 s con seq scan.
- El websocket de presencia agrupa eventos en ventanas de 250 ms; sin agrupar,
  un turno entrando a las 9:00 generaba mil mensajes y congelaba el panel.
- La exportacion de tickets a CSV corre en el worker con streaming por cursor;
  en la API se agotaba la memoria del pod con exports de mas de 80k filas.

## Runbook corto

- Deploy: merge a main, CI corre migraciones con lock advisory, canario al 10%
  durante 15 minutos, resto. Rollback = redeploy de la imagen anterior; las
  migraciones son compatibles hacia atras un release.
- Si WhatsApp reporta firmas invalidas tras rotar secretos: verificar que el
  secreto es el del ENDPOINT y purgar la config cacheada del adaptador.
- Si la cola crece sin workers caidos: revisar `ORDER BY` de los lotes y el
  `statement_timeout` del pool antes de escalar instancias.

Relacionado: [[STACKS/fastify]], [[PRACTICES/observability]],
[[PRACTICES/migrations]].
