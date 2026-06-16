---
type: project
created: 2026-01-03
tags: [wpf, dotnet, sqlite]
---

# app-inventory

Aplicacion de inventario de escritorio para una tienda deportiva. Cliente WPF
sobre .NET 8 con un backend ASP.NET Core 8 y base de datos SQLite embebida.

## Stack

- Cliente: WPF .NET 8, patron MVVM hecho a mano.
- API: ASP.NET Core 8 minimal APIs, health endpoint, hosted service factory.
- Datos: SQLite con WAL; portabilidad via LocalAppData.

## Reglas duras

- UI responsiva 2D obligatoria (ancho y alto).
- Permisos por constante en un solo lugar, no strings sueltos.
- Auditoria sensible protegida con PIN.
- CHANGELOG obligatorio por release.

Relacionado: [[STACKS/sqlite]], [[STACKS/dotnet]], [[RULES/inventory-rules]].
