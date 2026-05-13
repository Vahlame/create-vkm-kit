# Case study: MEP-style docente agent (PostgreSQL + Qdrant + FastAPI + Ley 8968)

This document sketches an **education-adjacent** deployment where a docente-facing agent reads curated corpora with **tenant isolation**. It is **not** legal advice; map controls to your DPIA with counsel (Costa Rica **Ley 8968** on personal data protection).

## Data model (PostgreSQL, RLS)

```sql
-- Tenants (e.g., schools)
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

-- Students / teachers (subjects of personal data)
create table subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  role text not null check (role in ('student','teacher')),
  pseudonym text not null,
  created_at timestamptz not null default now()
);

-- Documents indexed for the agent
create table documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table subjects enable row level security;
alter table documents enable row level security;

create policy tenant_isolation_subjects on subjects
  using (tenant_id = current_setting('app.tenant_id')::uuid);

create policy tenant_isolation_documents on documents
  using (tenant_id = current_setting('app.tenant_id')::uuid);
```

## Qdrant payload (tenant flag)

```json
{
  "id": "chunk-uuid",
  "vector": [0.01, 0.02],
  "payload": {
    "tenant_id": "uuid",
    "is_tenant": true,
    "document_id": "uuid",
    "heading": "H2 title"
  }
}
```

## FastAPI sketch

```python
from fastapi import FastAPI, Depends, Header
from uuid import UUID

app = FastAPI()

async def tenant_ctx(x_tenant_id: UUID = Header(...)):
    # set_config in pool checkout
    return x_tenant_id

@app.get("/documents")
async def list_docs(tenant_id: UUID = Depends(tenant_ctx)):
    ...
```

## MCP queries (agent docente)

- Retrieve **only** documents for `x-tenant-id` header set by the gateway.
- Log **hashes** of prompts, not raw student text, into observability (`gen_ai.prompt_hash`).

## Ley 8968 alignment (engineering controls)

- **Purpose limitation:** agent answers only within configured curricula scopes.
- **Minimization:** pseudonyms in `subjects`; avoid national IDs in prompts.
- **Retention:** TTL on raw traces in Langfuse / ClickHouse (see `compose.observability.yml`).
- **Security:** mTLS between services; rotate API keys; optional `age` for exported vault bundles.
