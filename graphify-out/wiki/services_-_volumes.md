# services / volumes

> 12 nodes · cohesion 0.17

## Key Concepts

- **services** (9 connections) — `deploy/selfhost/docker-compose.override.yml`
- **volumes** (5 connections) — `deploy/selfhost/docker-compose.override.yml`
- **docker-compose.override.yml** (2 connections) — `deploy/selfhost/docker-compose.override.yml`
- **api-gw** (2 connections) — `deploy/selfhost/docker-compose.override.yml`
- **auth** (2 connections) — `deploy/selfhost/docker-compose.override.yml`
- **supavisor** (2 connections) — `deploy/selfhost/docker-compose.override.yml`
- **ports** (1 connections) — `deploy/selfhost/docker-compose.override.yml`
- **ports** (1 connections) — `deploy/selfhost/docker-compose.override.yml`
- **caddy-config** (1 connections) — `deploy/selfhost/docker-compose.override.yml`
- **caddy-data** (1 connections) — `deploy/selfhost/docker-compose.override.yml`
- **discord-bot-data** (1 connections) — `deploy/selfhost/docker-compose.override.yml`
- **game-data** (1 connections) — `deploy/selfhost/docker-compose.override.yml`

## Relationships

- [discord-bot / game](discord-bot_-_game.md) (1 shared connections)
- [cloudflared / environment](cloudflared_-_environment.md) (1 shared connections)
- [healthcheck / healthcheck](healthcheck_-_healthcheck.md) (1 shared connections)
- [caddy / environment](caddy_-_environment.md) (1 shared connections)
- [game / build](game_-_build.md) (1 shared connections)
- [environment / API_EXTERNAL_URL](environment_-_API_EXTERNAL_URL.md) (1 shared connections)

## Source Files

- `deploy/selfhost/docker-compose.override.yml`

## Audit Trail

- EXTRACTED: 17 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*