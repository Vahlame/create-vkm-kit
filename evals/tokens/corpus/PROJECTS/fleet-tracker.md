---
type: project
created: 2026-03-02
tags: [mqtt, gps, timescale, maps]
---

# fleet-tracker

Rastreo de flota para una distribuidora regional: 120 camiones con GPS que
reportan por MQTT cada 10 segundos. Ingesta Node + broker EMQX, series de
tiempo en TimescaleDB, mapa en MapLibre.

## Ingesta y backpressure

- Los dispositivos publican en `flota/{vehiculo}/telemetria` con QoS 1; el
  consumidor escribe por lotes de 500 puntos o 2 segundos, lo que llegue
  primero.
- Buffer en memoria con marca de agua: al 80% se degrada el muestreo (se
  descarta 1 de cada 2 puntos intermedios, nunca eventos de encendido/apagado)
  y al 95% se pausa la suscripcion MQTT; reanudar es mas barato que perder el
  proceso por OOM, que fue el modo de fallo original.
- Los puntos llegan desordenados hasta 90 s cuando un camion recupera senal:
  la insercion usa la marca de tiempo del dispositivo, no la de llegada, y las
  agregaciones continuas de Timescale toleran ese lag configurado.

## Geocercas

- Geocercas poligonales por cliente (bodegas, rutas permitidas) guardadas como
  geometrias PostGIS; la evaluacion corre en el consumidor con point-in-polygon
  precompilado por vehiculo activo, no en la base.
- Distancias rapidas con Haversine para el radio de aproximacion; el poligono
  exacto solo se evalua dentro del radio, lo que bajo el costo de CPU 8 veces.
- Alertas de entrada/salida con histeresis de 30 segundos para no disparar
  rafagas cuando el GPS oscila en el borde de la geocerca.
- Cada alerta guarda el punto crudo que la disparo, para auditoria; hubo una
  disputa con un cliente y el punto crudo cerro la discusion.

## Series de tiempo

- Hypertable `telemetria` con chunks de 1 dia y compresion a partir de 7 dias:
  reduccion medida de 11x en disco.
- Agregaciones continuas por hora (distancia, velocidad maxima, paradas) que
  alimentan el dashboard; el mapa en vivo lee solo los ultimos 15 minutos.
- Retencion cruda de 90 dias; mas alla quedan solo las agregaciones. Legal
  pidio 1 año de recorridos: se cubre exportando las agregaciones a S3.

## Decisiones y gotchas

- EMQX gestionado en vez de Mosquitto propio: el cluster de Mosquitto perdia
  sesiones persistentes en failover y los dispositivos no re-suscribian bien.
- El firmware de 30 camiones viejos manda coordenadas con coma decimal; la
  normalizacion vive en un solo modulo `parse-nmea.ts` con tests de fixtures
  reales, no regada por el consumidor.
- Nunca confiar en el odometro del dispositivo: se calcula distancia por
  suma de segmentos GPS filtrando saltos mayores a 150 km/h.

## Mapa en vivo

- MapLibre con tiles vectoriales self-hosted; el vendor de tiles cobraba por
  vista y el mapa del despachador esta abierto 10 horas al dia.
- Los marcadores se actualizan por websocket con snap-to-road ligero en el
  cliente; el snap en servidor doblaba la latencia percibida sin mejorar la
  precision que el despachador necesita.
- Clustering de marcadores a partir de zoom 11; con 120 camiones sin cluster
  el canvas caia a 20 fps en las laptops viejas de despacho.
- El trazo historico de un vehiculo se simplifica con Douglas-Peucker
  (tolerancia 15 m) antes de dibujar: 40x menos puntos, misma forma visible.

## Alertas operativas

- Cuatro tipos en produccion: salida de geocerca, exceso de velocidad
  sostenido (mas de 30 s sobre el limite, para ignorar picos de GPS), parada
  no programada mayor a 15 minutos, y desconexion mayor a 5 minutos.
- Cada alerta tiene dedupe por (vehiculo, tipo) con ventana de 10 minutos;
  sin dedupe, un camion en zona de mala senal genero 200 notificaciones en
  una manana y el despachador silencio el canal entero.
- Escalado: la alerta no reconocida en 10 minutos pasa del despachador al
  supervisor; el reconocimiento queda en la bitacora con usuario y hora.

## Costos y capacidad

- La ingesta completa (120 camiones, punto cada 10 s) genera ~1 M filas/dia;
  con compresion de Timescale el disco crece ~80 MB/dia efectivos.
- El costo dominante es el broker gestionado, no la base; consolidar los
  topicos por flota (no por sensor) bajo la factura de EMQX un 35%.
- Prueba de capacidad: 500 camiones simulados sostenidos 24 h sin degradar
  el p95 de insercion; el cuello siguiente es el pool de conexiones de la
  base, documentado con el numero exacto (80) en el runbook.

## Runbook corto

- Camion "fantasma" (aparece en linea pero sin moverse horas): 9 de cada 10
  veces es firmware colgado; el comando remoto de reinicio esta en la consola
  de EMQX, topic `flota/{vehiculo}/cmd`.
- Si la ingesta se atrasa: revisar primero el lag del consumidor (metrica
  `buffer_fill`), no la base; escalar el consumidor es horizontal y barato.
- Restaurar un dia de telemetria: las agregaciones se recalculan con
  `refresh_continuous_aggregate` acotado a la ventana, nunca full refresh.

Relacionado: [[STACKS/terraform]], [[SESSION_LOG]].
