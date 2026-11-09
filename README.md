# ScamBox

Web game about opening crates with cards of famous people.

- Server: Rust (axum, tokio, sqlx) with PostgreSQL, in `server/`
- Frontend: React, TypeScript, Vite, Three.js, in `web/`; the built app is embedded into the server executable

## Run locally with Docker

Requires only Docker.

```
./lokalnie.sh          # Windows PowerShell: .\lokalnie.ps1
```

- Game: http://localhost:8000 (test account `admin` / `admin`)
- Mailpit (catches outgoing e-mail): http://localhost:8025
- Ports can be changed in `.env` (see `.env.example`)
- Reset: `docker compose -f docker-compose.local.yml down -v` and delete `data-lokalne/`

## Run from source

Requires Rust, Node.js and a PostgreSQL database
(`docker compose -f docker-compose.local.yml up -d db` starts one on localhost:5433).

```
cp server/.env.example server/.env      # set DATABASE_URL
cd web && npm install && npm run build
cd ../server && cargo run --release
```

Frontend development: `npx vite` in `web/` (proxies API calls to the server).
More options and platforms: [docs/uruchamianie.md](docs/uruchamianie.md).

## Tests

```
cd server && cargo test
cd web && npx tsc --noEmit
```

## Layout

- `server/` – game server, `server/data/game.json` holds game settings and built-in cards
- `web/` – frontend
- `static/` – images, sounds and other static files
- `seed/` – initial catalog for new databases
- `deploy/`, `docs/` – hosting and development notes (Polish)

## Hosting

See [docs/hosting.md](docs/hosting.md).
