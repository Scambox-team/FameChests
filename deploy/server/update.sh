#!/usr/bin/env bash
# Aktualizacja gry (i bota Discorda, jesli wlaczony profil "discord") do najnowszej wersji z repo.
set -euo pipefail
cd "$(dirname "$0")"
docker compose pull scambox
docker compose build --pull discord-bot 2>/dev/null || true
docker compose up -d --remove-orphans
docker image prune -f
echo "Gotowe."
