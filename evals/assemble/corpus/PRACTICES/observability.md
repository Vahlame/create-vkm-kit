---
type: practice
created: 2026-03-10
tags: [observability, logging, alertas]
---

# observability

Practica transversal de los proyectos en produccion: mesa de ayuda, dashboard
y planificador. Lo minimo que todo servicio debe exponer antes de salir.

## Reglas confirmadas

- Logs estructurados JSON con request-id propagado de extremo a extremo, del
  proxy al worker; la trazabilidad de una peticion se reconstruye buscando un
  solo identificador, sin herramientas extra.
- Metricas RED por endpoint (rate, errors, duration) mas UNA metrica de
  negocio elegida con el dueno del producto; en dos proyectos distintos la
  metrica de negocio detecto el incidente antes que ningun error tecnico.
- Alertas con dos umbrales: aviso al canal del equipo y critico que busca a la
  persona de guardia. Una sola lista de guardia, rotacion semanal, y toda
  alerta critica debe tener un runbook enlazado o se degrada a aviso.
- Trazas muestreadas al 5% + el 100% de las peticiones fallidas; trazar todo
  costaba mas que la base de datos en el plan del vendor.

## Antipatrones vistos

- Alertar sobre sintomas duplicados: tres alertas distintas para el mismo pool
  saturado despiertan tres veces a la misma persona por una causa.
- Dashboards sin dueno: el panel que nadie mira en dos sprints se archiva.
- Loguear el payload entero "por si acaso": costo, ruido y datos personales
  donde no deben estar.

Relacionado: [[PROJECTS/ticket-hub]], [[PROJECTS/menu-planner]].
