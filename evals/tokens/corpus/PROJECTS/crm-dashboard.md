---
type: project
created: 2026-02-10
tags: [node, postgres, stripe, saas]
---

# crm-dashboard

Panel CRM multi-tenant para agencias de viajes. API Node 22 + Fastify,
Postgres 16 particionado, frontend SvelteKit. Facturacion por suscripcion via
Stripe. En produccion desde marzo con 40 agencias activas.

## Arquitectura

- Monolito modular: `api/` expone REST + un websocket de notificaciones;
  `worker/` procesa colas (exportaciones, correos, webhooks salientes).
- Cada tenant vive en su particion por `tenant_id` (particionado declarativo
  LIST de Postgres); las consultas siempre entran por la clave de particion.
- Sesiones con JWT de acceso corto (10 min) + refresh token rotatorio en
  cookie httpOnly; la rotacion invalida la familia entera si se reusa un
  refresh viejo (deteccion de robo).
- Archivos adjuntos en S3 con URL prefirmadas de 5 minutos; el bucket es
  privado y el frontend jamas ve credenciales.

## Webhooks de Stripe

- Endpoint unico `/webhooks/stripe` verifica la firma con el secreto del
  endpoint, no el de la cuenta; en staging son secretos distintos y el error
  tipico es cruzarlos.
- Idempotencia por `event.id` persistido en la tabla `stripe_events` con
  indice unico; Stripe reintenta hasta 3 dias y sin esa tabla el doble cobro
  del plan anual se contabilizo dos veces (incidencia de abril, ya cerrada).
- Los eventos se encolan y responden 200 de inmediato; procesar en linea
  supero el timeout de 10 s de Stripe cuando el worker estaba frio.
- Reintentos internos con backoff exponencial 1s/4s/16s y dead letter queue en
  la tabla `webhook_dlq` revisada por alarma diaria.

## Migracion a particionado

- La tabla `contactos` (90 M filas) se migro en caliente: tabla nueva
  particionada + doble escritura via trigger + backfill por lotes de 50k con
  pausa adaptativa segun replication lag + swap de nombres en una transaccion.
- Ventana total: 6 noches; el swap final tomo 400 ms. Cero downtime medido.
- Leccion: el backfill debe ordenar por PK ascendente y guardar el cursor en
  una tabla de progreso, para reanudar tras cualquier corte sin duplicar.

## Decisiones cerradas

- Nada de ORM: SQL plano con pg + un query builder minimo propio de 120
  lineas. Los ORMs probados generaban N+1 en los listados con agregados.
- Busqueda full-text con tsvector espanol + indice GIN; se evaluo Elastic y
  se descarto por costo operativo para 40 tenants.
- Multi-tenancy por particion, no por esquema: 40 esquemas hicieron el
  autovacuum impredecible en la prueba de carga.

## Gotchas

- El pool de pg debe fijar `statement_timeout` por conexion; un reporte sin
  limite bloqueo el autovacuum de la particion mas grande 40 minutos.
- Las URL prefirmadas de S3 expiran en hora del servidor: un desfase de reloj
  de 3 minutos en un pod genero 403 intermitentes dificiles de reproducir.
- Fastify serializa con schemas: un campo nuevo sin declarar en el schema de
  respuesta simplemente desaparece del JSON (parece bug de datos y no lo es).

## Observabilidad

- Logs estructurados JSON con `pino`, un request-id propagado desde el proxy
  hasta el worker; buscar por request-id reconstruye la traza completa de una
  exportacion sin herramientas extra.
- Metricas RED por endpoint (rate, errors, duration) + una metrica de negocio:
  facturas emitidas por hora, que fue la que detecto el doble cobro antes que
  ningun error tecnico.
- Trazas solo en el 5% de requests muestreados + el 100% de los que fallan;
  trazar todo costaba mas que la base de datos en el plan del vendor.
- Alertas con dos umbrales: aviso (canal del equipo) y critico (busca a la
  persona de guardia); una sola lista de guardia, rotacion semanal.

## Rendimiento medido

- p95 del listado principal: 90 ms tras el indice compuesto
  `(tenant_id, actualizado_en)`; antes 1.4 s con seq scan en la particion.
- El websocket de notificaciones agrupa eventos en ventanas de 250 ms; sin
  agrupar, un import masivo generaba 3000 mensajes y congelaba la pestana.
- La exportacion a Excel corre en el worker con streaming por cursor; en la
  API se agotaba la memoria del pod con exports de mas de 100k filas.
- Cache de agregados del dashboard en Redis (TTL 60 s): el tablero pasa de 9
  consultas a 1 en el 95% de las cargas.

## Exportaciones e importaciones

- Import CSV con validacion en dos fases: primero se valida todo el archivo y
  se reporta cada fila mala con numero de linea; solo si el archivo entero es
  valido se aplica en una transaccion. Los imports parciales generaban
  tickets de soporte imposibles de reconstruir.
- Deduplicacion en el import por correo normalizado (trim + lowercase + sin
  puntos en gmail); el cliente decide si el duplicado se fusiona o se salta.
- Toda exportacion queda auditada: quien, cuando, que filtros; requisito del
  contrato con las agencias grandes por proteccion de datos.

## Runbook corto

- Deploy: merge a main → CI corre migraciones con lock advisory → despliegue
  canario al 10% durante 15 minutos → resto. Rollback = redeploy de la imagen
  anterior; las migraciones son siempre compatibles hacia atras un release.
- Si Stripe reporta firmas invalidas tras rotar secretos: verificar que el
  secreto es el del ENDPOINT (no el de la cuenta) y purgar la config cacheada.
- Si el autovacuum se atrasa en una particion caliente: bajar
  `autovacuum_vacuum_cost_delay` solo en esa particion, no global.

Relacionado: [[STACKS/redis]], [[STACKS/terraform]], [[SESSION_LOG]].
