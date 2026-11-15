#!/usr/bin/env bash
# Import zrzutu pg_dump (plain SQL) ze Supabase do bazy famechests.
# Bledy dot. schematow/rozszerzen tylko Supabase (auth, storage, graphql, pgsodium, vault,
# realtime, supabase_functions, extensions) sa OCZEKIWANE i nieszkodliwe - patrz import-errors.log.
# Uzycie: ./import-db.sh [--reset] plik.sql
set -euo pipefail
cd "$(dirname "$0")"
RESET=0
if [ "${1:-}" = "--reset" ]; then RESET=1; shift; fi
SQL="${1:-}"
[ -n "$SQL" ] && [ -f "$SQL" ] || { echo "Uzycie: $0 [--reset] <plik.sql>" >&2; exit 1; }

# scambox nie moze dzialac podczas importu
if [ -n "$(docker compose ps -q scambox 2>/dev/null)" ]; then docker compose stop scambox; fi
docker compose up -d db
echo "Czekam na baze..."
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' famechests-db 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' famechests-db)" = healthy ] || { echo "db nie jest healthy" >&2; exit 1; }

PSQL=(docker compose exec -T db psql -U postgres -d famechests)

if [ "$RESET" = 1 ]; then
  read -r -p "To USUNIE schemat famechests (DROP SCHEMA ... CASCADE). Wpisz 'tak': " ans
  [ "$ans" = tak ] || { echo "Przerwano."; exit 1; }
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS famechests CASCADE; CREATE SCHEMA famechests;"
fi

for r in anon authenticated service_role supabase_admin supabase_auth_admin supabase_storage_admin \
         authenticator dashboard_user pgbouncer supabase_realtime_admin supabase_replication_admin \
         supabase_read_only_user; do
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$r') THEN CREATE ROLE $r NOLOGIN; END IF; END \$\$;"
done

echo "Import $SQL (bledy -> import-errors.log)..."
"${PSQL[@]}" -v ON_ERROR_STOP=0 < "$SQL" > /dev/null 2> import-errors.log || true
echo "Linii bledow: $(grep -c ERROR import-errors.log || true)"

echo "Liczba wierszy w schemacie famechests:"
"${PSQL[@]}" -At -c "SELECT format('SELECT %L, count(*) FROM %I.%I', table_name, table_schema, table_name) FROM information_schema.tables WHERE table_schema='famechests' AND table_type='BASE TABLE' ORDER BY 1" \
 | while read -r q; do "${PSQL[@]}" -At -F ': ' -c "$q"; done
