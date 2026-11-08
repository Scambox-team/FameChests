#!/bin/sh
# Test lokalny w Dockerze (Linux/macOS/Git Bash). Rust nie ma live reload: po zmianie kodu uruchom skrypt ponownie
# (zależności są w cache'u cargo-chef, więc przebudowa trwa krótko).
cd "$(dirname "$0")" || exit 1
echo "Gra:     http://localhost:${SCAMBOX_PORT:-8000}  (login: admin, hasło: admin)"
echo "Mailpit: http://localhost:${SCAMBOX_MAIL_PORT:-8025}  (tu lądują wszystkie maile z gry)  (Ctrl+C zatrzymuje)"
exec docker compose -f docker-compose.local.yml up --build
