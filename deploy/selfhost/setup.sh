#!/bin/sh
# Pierwsza konfiguracja: tworzy .env z .env.example i generuje wszystkie hasła i klucze (Supabase + gra).
# Uruchom raz, w tym folderze:  sh setup.sh
# Wymaga: openssl. Istniejącego .env nie nadpisuje.
set -e
cd "$(dirname "$0")"

if [ -f .env ]; then
    echo "Plik .env już istnieje - nic nie zmieniam (usuń go, jeśli chcesz zacząć od nowa)."
    exit 1
fi
command -v openssl >/dev/null 2>&1 || { echo "Brak openssl (apt install openssl)"; exit 1; }

cp .env.example .env
chmod 600 .env

# hasła i klucze Supabase (oficjalny skrypt: POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, DASHBOARD_PASSWORD...)
sh utils/generate-keys.sh --update-env >/dev/null

# pozostałe wartości z przykładowymi danymi w .env.example
sed -i.old \
    -e "s|^POOLER_TENANT_ID=.*$|POOLER_TENANT_ID=scambox-$(openssl rand -hex 4)|" \
    -e "s|^OPENAI_API_KEY=.*$|OPENAI_API_KEY=|" \
    -e "s|^GAME_SECRET_KEY=$|GAME_SECRET_KEY=$(openssl rand -hex 32)|" \
    .env
rm -f .env.old

echo "Gotowe: .env z losowymi hasłami (tylko dla właściciela pliku)."
echo
echo "Teraz uzupełnij w .env:"
echo "  CLOUDFLARE_TUNNEL_TOKEN  token tunelu Cloudflare (albo COMPOSE_PROFILES=caddy + GAME_DOMAIN)"
echo "  GAME_SECRET_KEY          SECRET_KEY z Azure (wpisany losowy = wszyscy gracze zostaną wylogowani)"
echo "  GAME_OWNER_IDS           id konta właściciela (kopie bazy w panelu)"
echo "  GAME_OPERATOR_NAME, GAME_CONTACT_EMAIL"
echo
echo "Login do Supabase Studio: DASHBOARD_USERNAME / DASHBOARD_PASSWORD z .env"
