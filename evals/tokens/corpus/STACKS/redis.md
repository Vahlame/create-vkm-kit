---
type: stack
created: 2026-01-05
tags: [redis, cache, infra]
---

# redis

Cache y colas ligeras para los proyectos de dashboard y punto de venta. Redis 7
gestionado (ElastiCache) en produccion; contenedor local para desarrollo.

## Cache de lecturas

- Patron cache-aside: la app consulta Redis, si falla va a Postgres y rellena.
- TTL base de 300 segundos con jitter aleatorio de +-20% para evitar la
  estampida de expiraciones sincronizadas (thundering herd) cuando un lote de
  claves se cargo en el mismo despliegue.
- Claves con prefijo por dominio y version de esquema: `crm:v3:cuenta:{id}`.
  Subir la version invalida todo el dominio sin FLUSHDB.
- Nunca cachear respuestas de error ni resultados vacios de busquedas; un 404
  cacheado escondio cuentas nuevas durante minutos en el primer intento.

## Colas y locks

- Colas simples con LPUSH/BRPOP para trabajos de exportacion; nada de streams
  mientras el volumen sea menor a mil trabajos por hora.
- Lock distribuido con SET NX PX y token aleatorio; liberar solo si el token
  coincide (script Lua), si no un worker lento borra el lock de otro.
- Timeout de lock corto (30 s) y renovacion explicita; un lock eterno detuvo
  la facturacion una madrugada entera.

## Gotchas medidos

- MAXMEMORY con politica allkeys-lru en cache puro; noeviction en la instancia
  que respalda colas, porque perder trabajos en silencio es peor que un error.
- Las conexiones no se comparten entre forks del worker: pool por proceso.
- SCAN con COUNT 100 para housekeeping; KEYS en produccion bloqueo el event
  loop 4 segundos con 2 millones de claves.

Relacionado: [[PROJECTS/crm-dashboard]], [[PROJECTS/pos-terminal]].
