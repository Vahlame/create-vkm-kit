---
type: stack
created: 2026-01-08
tags: [terraform, aws, infra]
---

# terraform

Infraestructura como codigo para los tres proyectos activos. Terraform 1.9,
proveedor AWS, un workspace por ambiente (dev, staging, prod).

## Estado remoto

- Backend S3 con versionado activado + candado de estado en DynamoDB
  (tabla `tf-locks`, clave `LockID`). Sin el candado, dos applies simultaneos
  corrompieron el estado de staging una vez; recuperado desde la version
  anterior del bucket.
- Un state por proyecto y ambiente: `crm/prod/terraform.tfstate`. Nada de
  megastate compartido; el blast radius de un apply debe ser un solo servicio.
- `terraform plan -out` obligatorio en CI; el apply consume exactamente ese
  plan aprobado, nunca replanifica.

## Modulos propios

- `module/vpc-base`: VPC de tres subredes privadas + endpoints de S3 y ECR,
  para no pagar NAT por trafico interno de imagenes.
- `module/service-ecs`: servicio Fargate con autoscaling por CPU y cola; toma
  la imagen por digest, no por tag mutable.
- `module/rds-postgres`: instancia con backups a 14 dias, parametro
  `rds.force_ssl=1` y alarma de conexiones al 80%.

## Reglas de operacion

- Variables sensibles solo via SSM Parameter Store; ningun secreto en tfvars
  ni en el state (se revisa con trivy en CI).
- `prevent_destroy` en RDS y buckets con datos; borrar exige editar el codigo,
  no un apply distraido.
- Drift check nocturno con `plan -detailed-exitcode`; si hay drift, issue
  automatico con el diff.

Relacionado: [[PROJECTS/crm-dashboard]], [[PROJECTS/fleet-tracker]].
