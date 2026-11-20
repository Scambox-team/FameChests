# services / mailpit

> 8 nodes · cohesion 0.25

## Key Concepts

- **services** (5 connections) — `docker-compose.local.yml`
- **mailpit** (3 connections) — `docker-compose.local.yml`
- **volumes** (3 connections) — `docker-compose.local.yml`
- **docker-compose.local.yml** (2 connections) — `docker-compose.local.yml`
- **image** (1 connections) — `docker-compose.local.yml`
- **ports** (1 connections) — `docker-compose.local.yml`
- **scambox-local-bot** (1 connections) — `docker-compose.local.yml`
- **scambox-local-db** (1 connections) — `docker-compose.local.yml`

## Relationships

- [app / depends_on](app_-_depends_on.md) (1 shared connections)
- [discord-bot / build](discord-bot_-_build.md) (1 shared connections)
- [db / environment](db_-_environment.md) (1 shared connections)

## Source Files

- `docker-compose.local.yml`

## Audit Trail

- EXTRACTED: 10 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*