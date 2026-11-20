# services / server/docker-compose.yml

> 12 nodes · cohesion 0.17

## Key Concepts

- **services** (8 connections) — `deploy/server/docker-compose.yml`
- **server/docker-compose.yml** (5 connections) — `deploy/server/docker-compose.yml`
- **volumes** (4 connections) — `deploy/server/docker-compose.yml`
- **configs** (3 connections) — `deploy/server/docker-compose.yml`
- **auth_init_sql** (2 connections) — `deploy/server/docker-compose.yml`
- **fw_sh** (2 connections) — `deploy/server/docker-compose.yml`
- **content** (1 connections) — `deploy/server/docker-compose.yml`
- **content** (1 connections) — `deploy/server/docker-compose.yml`
- **name** (1 connections) — `deploy/server/docker-compose.yml`
- **db-data** (1 connections) — `deploy/server/docker-compose.yml`
- **discord-bot-data** (1 connections) — `deploy/server/docker-compose.yml`
- **game-data** (1 connections) — `deploy/server/docker-compose.yml`

## Relationships

- [tunnel-net / config](tunnel-net_-_config.md) (1 shared connections)
- [scambox / depends_on](scambox_-_depends_on.md) (1 shared connections)
- [db / environment](db_-_environment.md) (1 shared connections)
- [discord-bot / build](discord-bot_-_build.md) (1 shared connections)
- [fw / configs](fw_-_configs.md) (1 shared connections)
- [cloudflared / depends_on](cloudflared_-_depends_on.md) (1 shared connections)
- [auth-init / environment](auth-init_-_environment.md) (1 shared connections)
- [auth / depends_on](auth_-_depends_on.md) (1 shared connections)

## Source Files

- `deploy/server/docker-compose.yml`

## Audit Trail

- EXTRACTED: 19 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*