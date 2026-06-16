---
type: project
created: 2026-01-05
tags: [wpf, dotnet]
---

# win-optimizer

Motor de optimizacion para Windows 10/11, safe-by-design. Aplicacion WPF sobre
.NET 9 que aplica y revierte tweaks del sistema operativo.

## Arquitectura

- Solucion de varios proyectos: Core + Platform + Cli + App + tests.
- Clasificacion de hardware: Legacy / Current / Modern, deteccion de DDR5.
- Dashboard con metricas antes/despues de cada optimizacion.

## Distribucion

- Instalador Inno Setup; modelo freemium.
- Auto-commit y push por cada cambio logico, sin hook.

Relacionado: [[STACKS/dotnet]], [[STACKS/wpf]].
