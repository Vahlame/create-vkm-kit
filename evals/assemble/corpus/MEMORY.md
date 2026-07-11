---
type: memory
created: 2026-02-01
---

# MEMORY

Preferencias firmes del usuario y hechos estables entre sesiones.

## Preferencias

- Idioma: explicaciones en espanol; todo lo embebido en el codigo (nombres,
  comentarios, docstrings) en ingles.
- Commits convencionales (`feat:`, `fix:`, `chore:`) y ramas por feature;
  nunca push directo a main.
- Todo cambio de infraestructura exige rollback probado antes del deploy, no
  descrito: se ejecuta la vuelta atras en staging y se anota el resultado.
- Revisiones de codigo con profundidad completa, ordenadas por severidad.

## Hechos estables

- Entorno principal: Windows 11 + PowerShell 7; los proyectos de cocina
  corren en tabletas Android con la app de escritorio empaquetada.
- Los fines de semana no se despliega salvo incidente critico declarado.
