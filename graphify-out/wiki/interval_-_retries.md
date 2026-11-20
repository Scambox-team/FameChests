# interval / retries

> 15 nodes · cohesion 0.42

## Key Concepts

- **interval** (10 connections) — `deploy/selfhost/docker-compose.yml`
- **retries** (10 connections) — `deploy/selfhost/docker-compose.yml`
- **test** (10 connections) — `deploy/selfhost/docker-compose.yml`
- **timeout** (10 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (6 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (6 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (6 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (6 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (5 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (5 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (5 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (5 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (5 connections) — `deploy/selfhost/docker-compose.yml`
- **healthcheck** (5 connections) — `deploy/selfhost/docker-compose.yml`
- **start_period** (4 connections) — `deploy/selfhost/docker-compose.yml`

## Relationships

- [services / supavisor](services_-_supavisor.md) (4 shared connections)
- [api-gw / depends_on](api-gw_-_depends_on.md) (1 shared connections)
- [db / command](db_-_command.md) (1 shared connections)
- [functions / api-gw](functions_-_api-gw.md) (1 shared connections)
- [imgproxy / environment](imgproxy_-_environment.md) (1 shared connections)
- [environment / rest](environment_-_rest.md) (1 shared connections)
- [storage / depends_on](storage_-_depends_on.md) (1 shared connections)

## Source Files

- `deploy/selfhost/docker-compose.yml`

## Audit Trail

- EXTRACTED: 54 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*