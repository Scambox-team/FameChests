@echo off
rem Gra na tym komputerze (http://127.0.0.1:5000). Wymaga: Rust (rustup), baza PostgreSQL
rem (docker compose -f docker-compose.local.yml up -d db, port 5433) i server\.env z DATABASE_URL (wzor: server\.env.example).
rem Dodatkowe opcje: --lan (siec lokalna), --test (osobna baza, port 5001), --dev
cd /d "%~dp0..\..\web"
call npm install --no-audit --no-fund
call npm run build
cd /d "%~dp0..\..\server"
start "" http://127.0.0.1:5000
cargo run --release -- %*
pause
