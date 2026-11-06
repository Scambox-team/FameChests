#!/bin/sh
# Przenosi dane gry z Supabase w chmurze do lokalnego Supabase (ten folder).
#
#   sh migrate-from-supabase.sh "postgresql://postgres.<projekt>:<hasło>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
#   sh migrate-from-supabase.sh --force "..."   # lokalny schemat gry już istnieje: kopia do backups/, usunięcie, wczytanie
#
# Adres: DATABASE_URL z Azure (session pooler, port 5432). Baza w chmurze jest tylko CZYTANA (pg_dump).
# Kopiowany jest tylko schemat gry (GAME_DB_SCHEMA z .env, domyślnie famechests). Zrzut zostaje w backups/.
# Przed ostatnim przeniesieniem zatrzymaj grę na Azure - inaczej zmiany graczy po zrzucie przepadną.
set -e
cd "$(dirname "$0")"

FORCE=0
if [ "$1" = "--force" ]; then FORCE=1; shift; fi
SRC="$1"
if [ -z "$SRC" ]; then
    sed -n '2,10p' "$0"
    exit 1
fi
[ -f .env ] || { echo "Brak .env - najpierw: sh setup.sh"; exit 1; }

SCHEMA=$(grep '^GAME_DB_SCHEMA=' .env | cut -d= -f2- | tr -d '\r')
SCHEMA=${SCHEMA:-famechests}
case "$SCHEMA" in *[!a-z0-9_]*) echo "GAME_DB_SCHEMA: tylko małe litery, cyfry i _"; exit 1 ;; esac

psql_local() {
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d postgres -tA "$@"
}

echo "== Uruchamiam lokalną bazę (db)"
docker compose up -d --wait db

echo "== Zatrzymuję grę (żeby nie pisała do bazy w trakcie)"
docker compose stop game 2>/dev/null || true

mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)

EXISTS=$(psql_local -c "SELECT 1 FROM pg_namespace WHERE nspname = '$SCHEMA'")
if [ "$EXISTS" = "1" ]; then
    if [ "$FORCE" != "1" ]; then
        echo "Lokalny schemat '$SCHEMA' już istnieje (np. gra wystartowała na pustej bazie)."
        echo "Uruchom z --force: zrobię jego kopię w backups/ i wczytam dane z chmury od nowa."
        exit 1
    fi
    echo "== Kopia obecnego lokalnego schematu -> backups/local-$SCHEMA-$STAMP.dump"
    docker compose exec -T db pg_dump -h localhost -U postgres -d postgres --schema="$SCHEMA" -Fc \
        > "backups/local-$SCHEMA-$STAMP.dump"
    psql_local -c "SET client_min_messages = warning; DROP SCHEMA \"$SCHEMA\" CASCADE" >/dev/null
fi

DUMP="backups/cloud-$SCHEMA-$STAMP.dump"
echo "== Zrzut z chmury (schemat $SCHEMA) -> $DUMP"
# pg_dump z obrazu supabase/postgres (ta sama wersja 17 co w chmurze); adres w zmiennej, nie w poleceniu
docker compose exec -T -e SRC_URL="$SRC" db sh -c \
    'pg_dump "$SRC_URL" --schema="$0" --no-owner --no-privileges -Fc' "$SCHEMA" > "$DUMP"
[ -s "$DUMP" ] || { echo "Pusty zrzut - sprawdź adres bazy"; exit 1; }
echo "   $(du -h "$DUMP" | cut -f1)"

echo "== Wczytuję do lokalnej bazy"
docker compose exec -T db pg_restore -h localhost -U postgres -d postgres \
    --no-owner --no-privileges --exit-on-error < "$DUMP"

echo "== Sprawdzenie"
psql_local -c "SELECT 'tabele: ' || count(*) FROM information_schema.tables WHERE table_schema = '$SCHEMA'"
psql_local -c "SELECT 'gracze: ' || count(*) FROM \"$SCHEMA\".users" 2>/dev/null || true

echo
echo "Gotowe. Uruchom całość:  docker compose up -d"
