@echo off
rem Uruchamia gre dostepna w sieci lokalnej (np. w akademiku). Adres dla znajomych pojawi sie ponizej.
cd /d "%~dp0web"
call npm install --no-audit --no-fund
call npm run build
cd /d "%~dp0server"
cargo run --release -- --lan %*
pause
