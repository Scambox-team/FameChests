# db / environment

> 8 nodes · cohesion 0.25

## Key Concepts

- **db** (6 connections) — `docker-compose.local.yml`
- **environment** (4 connections) — `docker-compose.local.yml`
- **image** (1 connections) — `docker-compose.local.yml`
- **ports** (1 connections) — `docker-compose.local.yml`
- **volumes** (1 connections) — `docker-compose.local.yml`
- **POSTGRES_DB** (1 connections) — `docker-compose.local.yml`
- **POSTGRES_PASSWORD** (1 connections) — `docker-compose.local.yml`
- **POSTGRES_USER** (1 connections) — `docker-compose.local.yml`

## Relationships

- [services / mailpit](services_-_mailpit.md) (1 shared connections)
- [healthcheck / interval](healthcheck_-_interval.md) (1 shared connections)

## Source Files

- `docker-compose.local.yml`

## Audit Trail

- EXTRACTED: 9 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*