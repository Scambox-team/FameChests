# Test lokalny w Dockerze (Windows). Rust nie ma live reload: po zmianie kodu uruchom skrypt ponownie
# (zależności są w cache'u cargo-chef, więc przebudowa trwa krótko).
Set-Location -Path $PSScriptRoot
$port = if ($env:SCAMBOX_PORT) { $env:SCAMBOX_PORT } else { '8000' }
$mail = if ($env:SCAMBOX_MAIL_PORT) { $env:SCAMBOX_MAIL_PORT } else { '8025' }
Write-Host "Gra:     http://localhost:$port  (login: admin, hasło: admin)"
Write-Host "Mailpit: http://localhost:$mail  (tu lądują wszystkie maile z gry)  (Ctrl+C zatrzymuje)"
docker compose -f docker-compose.local.yml up --build
