# transforms / auth_logs

> 20 nodes · cohesion 0.10

## Key Concepts

- **transforms** (12 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **auth_logs** (4 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **functions_logs** (4 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **realtime_logs** (4 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **rest_logs** (4 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **router** (4 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **inputs** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **source** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **type** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **inputs** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **source** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **type** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **inputs** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **source** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **type** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **inputs** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **source** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **type** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **inputs** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **type** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`

## Relationships

- [sinks / logflare_storage](sinks_-_logflare_storage.md) (1 shared connections)
- [realtime_logs_filtered / condition](realtime_logs_filtered_-_condition.md) (1 shared connections)
- [project_logs / inputs](project_logs_-_inputs.md) (1 shared connections)
- [storage_logs / inputs](storage_logs_-_inputs.md) (1 shared connections)
- [db_logs / inputs](db_logs_-_inputs.md) (1 shared connections)
- [kong_logs / inputs](kong_logs_-_inputs.md) (1 shared connections)
- [kong_err / inputs](kong_err_-_inputs.md) (1 shared connections)
- [route / auth](route_-_auth.md) (1 shared connections)

## Source Files

- `deploy/selfhost/volumes/logs/vector.yml`

## Audit Trail

- EXTRACTED: 27 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*