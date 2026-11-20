# sinks / logflare_storage

> 14 nodes · cohesion 0.14

## Key Concepts

- **sinks** (8 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **logflare_storage** (7 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **vector.yml** (4 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **api** (3 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **docker_host** (3 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **sources** (2 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **address** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **enabled** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **exclude_containers** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **type** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **inputs** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **method** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **type** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`
- **uri** (1 connections) — `deploy/selfhost/volumes/logs/vector.yml`

## Relationships

- [codec / logflare_db](codec_-_logflare_db.md) (3 shared connections)
- [transforms / auth_logs](transforms_-_auth_logs.md) (1 shared connections)
- [logflare_auth / encoding](logflare_auth_-_encoding.md) (1 shared connections)
- [logflare_realtime / encoding](logflare_realtime_-_encoding.md) (1 shared connections)
- [logflare_rest / encoding](logflare_rest_-_encoding.md) (1 shared connections)
- [logflare_kong / encoding](logflare_kong_-_encoding.md) (1 shared connections)
- [headers / retry_initial_backoff_secs](headers_-_retry_initial_backoff_secs.md) (1 shared connections)

## Source Files

- `deploy/selfhost/volumes/logs/vector.yml`

## Audit Trail

- EXTRACTED: 22 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*