---
type: log
created: 2026-02-12
tags: [session-log]
---

# SESSION_LOG

Append-only. Una entrada por cierre de sesion, la mas nueva al final.

## 2026-02-12 — crm-dashboard: esqueleto del monolito

- Fastify + estructura `api/` y `worker/`; healthcheck y CI minima verdes.
- Decidido monolito modular sobre microservicios: un equipo de dos personas
  no amortiza la operacion de mas de un despliegue.

## 2026-02-26 — crm-dashboard: sesiones y refresh rotatorio

- JWT corto + refresh rotatorio con deteccion de reuso; la familia entera se
  invalida si aparece un refresh viejo. Tests de la rotacion en verde.
- Gotcha: la cookie httpOnly necesita `SameSite=Lax` o el websocket de
  notificaciones no autentica en el primer handshake.

## 2026-03-10 — crm-dashboard: salida a produccion

- 12 agencias migradas la primera semana, sin incidencias de datos.
- Alarma de p95 configurada en 400 ms; el listado de contactos quedo en 90 ms
  tras el indice compuesto `(tenant_id, actualizado_en)`.

## 2026-03-24 — fleet-tracker: arranque del proyecto

- EMQX gestionado elegido tras la prueba de failover; Mosquitto perdia
  sesiones persistentes y 30 camiones quedaban mudos hasta reiniciar.
- Primer consumidor MQTT con lotes de 500 puntos; hypertable creada.

## 2026-04-07 — fleet-tracker: OOM del consumidor resuelto

- El consumidor moria por OOM cuando una zona sin cobertura soltaba rafagas
  de puntos atrasados. Implementado buffer con marca de agua: degradar
  muestreo al 80%, pausar suscripcion al 95%. Sin caidas desde entonces.
- Leccion: pausar la suscripcion MQTT es reversible; reventar el proceso no.

## 2026-04-18 — crm-dashboard: incidencia del doble cobro (CERRADA)

- Causa raiz: el webhook `invoice.paid` de Stripe llego dos veces (reintento
  legitimo) y no habia idempotencia; el plan anual de una agencia se
  contabilizo doble. Registro corregido y cliente notificado el mismo dia.
- Fix: tabla `stripe_events` con indice unico por `event.id` + encolar y
  responder 200 de inmediato. Reproducido en staging con `stripe trigger` y
  verificado que el segundo evento se descarta.
- Accion preventiva: alarma diaria sobre `webhook_dlq` y runbook de
  reconciliacion manual en el repo.

## 2026-05-02 — pos-terminal: primer piloto en ferreteria

- Piloto con 2 cajas en la ferreteria del centro; 600 ventas en 3 dias sin
  perdida de datos, incluido un corte de luz a media tarde.
- El outbox con numero de secuencia reanudo limpio tras el corte: cero ventas
  duplicadas en el servidor.

## 2026-05-14 — fleet-tracker: corte de datos del 14 de mayo (POSTMORTEM)

- 40 minutos sin ingesta: el certificado TLS del broker EMQX expiro y los
  dispositivos rechazaron la conexion. Los camiones bufferean 2 horas en
  memoria local, asi que al renovar el certificado la telemetria atrasada
  entro completa; perdida real: solo 3 vehiculos que reiniciaron en el gap.
- Accion: renovacion automatica del certificado + alarma 21 dias antes de
  expirar + prueba mensual de reconexion masiva en staging.
- Leccion: la marca de tiempo del dispositivo (no la de llegada) fue lo que
  permitio reconstruir los recorridos sin huecos visibles.

## 2026-05-27 — crm-dashboard: migracion de contactos a particionado

- Terminadas las 6 noches de backfill; swap final en 400 ms dentro de una
  transaccion. Cero downtime reportado por el monitoreo externo.
- El cursor de progreso en tabla propia salvo la noche 4: un deploy reinicio
  el worker a mitad de lote y el backfill reanudo exacto donde iba.

## 2026-06-05 — pos-terminal: facturacion electronica aprobada

- Primeras 200 facturas aceptadas por Hacienda en produccion; 3 rechazos por
  cedula mal formada se reprocesaron corrigiendo solo el receptor.
- La situacion "contingencia" se probo desconectando la terminal 26 horas:
  la clave de 50 digitos se genero offline y el envio diferido paso.

## 2026-06-12 — fleet-tracker: geocercas con histeresis

- Alertas de entrada/salida con histeresis de 30 s en produccion; las rafagas
  falsas en el borde de la geocerca bajaron de 40 por dia a cero.
- La disputa con el cliente de la bodega norte se cerro mostrando el punto
  crudo que disparo la alerta: el camion si salio de la ruta permitida.

## 2026-06-20 — pos-terminal: impresion bajo carga

- Reemplazado el spooler de Windows por escritura raw ESC/POS: bajo carga el
  spooler reordenaba tickets y dos clientes se llevaron el ticket ajeno.
- Cola propia con reintento y reimpresion desde historial; venta nunca se
  bloquea por impresora sin papel.

## 2026-06-28 — infra: drift check nocturno en Terraform

- `plan -detailed-exitcode` nocturno sobre los tres proyectos; el primer run
  encontro drift real: una regla de security group agregada a mano durante el
  postmortem del 14 de mayo. Importada al codigo y cerrada.
- Regla nueva: todo cambio manual de emergencia se importa al dia siguiente.

## 2026-07-03 — crm-dashboard: import CSV en dos fases

- Rediseñado el import masivo: validacion del archivo completo primero (cada
  fila mala con numero de linea), aplicacion despues en una transaccion.
  Los imports parciales generaban tickets de soporte irreconstruibles.
- Deduplicacion por correo normalizado; la agencia decide fusionar o saltar.
- 4 imports grandes del piloto pasaron limpios; soporte sin tickets nuevos.

## 2026-07-11 — fleet-tracker: prueba de capacidad a 500 camiones

- Simulados 500 camiones sostenidos 24 horas: p95 de insercion estable; el
  cuello siguiente es el pool de conexiones de la base (80), documentado.
- Consolidar topicos por flota bajo la factura del broker un 35%.
- El clustering del mapa a partir de zoom 11 mantuvo 60 fps en las laptops
  de despacho; sin cluster caian a 20 fps.

## 2026-07-19 — pos-terminal: cierre ciego de caja

- Cierre en dos pasos (conteo ciego, luego diferencia) desplegado en las 5
  ferreterias; lo pidio la duena tras faltantes repetidos con el flujo viejo.
- El reporte Z con hash encadenado detecto su primera edicion manual: un
  supervisor "corrigio" un cierre desde un editor de SQLite; conversacion
  incomoda pero exactamente para eso existe la cadena.

## 2026-07-26 — crm-dashboard: canario y rollback ensayado

- Primer deploy canario al 10% con rollback ensayado en frio: redeploy de la
  imagen anterior en 90 segundos, migraciones compatibles un release atras.
- Ensayarlo en frio revelo que el script de rollback asumia un tag `latest`
  que ya no se publica; corregido antes de necesitarlo de verdad.

## 2026-08-02 — fleet-tracker: alerta de exceso de velocidad sostenido

- Nueva alerta: mas de 30 segundos sobre el limite (ignora picos de GPS).
  Dedupe por vehiculo y tipo con ventana de 10 minutos.
- El escalado despachador→supervisor a los 10 minutos sin reconocer quedo en
  la bitacora con usuario y hora; el sindicato pidio y acepto esa trazabilidad.

## 2026-08-09 — pos-terminal: canal piloto de actualizaciones

- Canal estable + canal piloto (ferreteria del centro una semana antes): dos
  bugs de impresion atrapados en piloto, cero en el resto de tiendas.
- Regla dura confirmada: actualizar solo al cierre de caja; el update de media
  tarde que congelo la cola de tickets no se repite.

## 2026-08-16 — infra: alarma de certificados y simulacro

- Simulacro mensual de reconexion masiva MQTT en staging: los 120 clientes
  simulados reconectan en menos de 60 segundos tras rotar el certificado.
- La alarma de expiracion a 21 dias disparo por primera vez (certificado del
  dominio de staging); renovado sin incidente. El proceso funciona.

## 2026-08-23 — crm-dashboard: cache de agregados del dashboard

- Agregados del tablero cacheados en Redis con TTL 60 s + jitter: el tablero
  pasa de 9 consultas a 1 en el 95% de las cargas; p95 de la home 220→70 ms.
- Se respeta la regla de no cachear vacios: un tenant nuevo veia "sin datos"
  cacheado 5 minutos en la primera prueba; corregido antes de produccion.

## 2026-08-30 — pos-terminal: exportacion contable validada

- Formato CSV del contador validado con el contador real: dos columnas que
  "obviamente" sobraban eran obligatorias para su sistema; preguntarlo antes
  ahorro un mes de idas y vueltas.
- La exportacion corre al cierre del ultimo dia del mes y queda en la carpeta
  compartida con nombre `AAAA-MM-cierre.csv`; sin pasos manuales.

## 2026-09-06 — fleet-tracker: simplificacion de trazos historicos

- Douglas-Peucker con tolerancia de 15 metros para el trazo historico: 40x
  menos puntos dibujados, forma identica a la vista; el reporte semanal de
  recorridos por camion carga en 1 segundo en vez de 12.
- El despachador senior valido a ojo 20 recorridos simplificados contra los
  crudos: ninguna divergencia operativa visible.
