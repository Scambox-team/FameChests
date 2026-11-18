#!/usr/bin/env bash
# Generuje brakujace klucze GoTrue i DOPISUJE je do .env (nigdy nie nadpisuje, nie wypisuje wartosci).
# JWT_SECRET, AUTH_DB_PASSWORD, SERVICE_ROLE_KEY (JWT HS256 role=service_role, wazny 10 lat).
# Uzycie: ./gen-auth-keys.sh [plik_env]   (domyslnie .env)
set -euo pipefail
cd "$(dirname "$0")"
ENVF="${1:-.env}"
[ -f "$ENVF" ] || { echo "Brak $ENVF" >&2; exit 1; }
command -v openssl >/dev/null || { echo "Wymagany openssl" >&2; exit 1; }

# wartosc klucza z pliku (ostatnie wystapienie, bez cudzyslowow)
getv() { grep -E "^$1=" "$ENVF" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
add() { # add KLUCZ WARTOSC - tylko gdy brak lub pusty
  if [ -n "$(getv "$1")" ]; then echo "$1: juz ustawiony - pomijam"; return; fi
  grep -vE "^$1=" "$ENVF" > "$ENVF.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENVF.tmp"
  cat "$ENVF.tmp" > "$ENVF"; rm -f "$ENVF.tmp"
  echo "$1: dopisany"
}

# JWT_SECRET (alfanumeryczne, 48 znakow) - potrzebny do podpisania SERVICE_ROLE_KEY
JWT="$(getv JWT_SECRET)"
if [ -z "$JWT" ]; then JWT="$(openssl rand -hex 24)"; fi
add JWT_SECRET "$JWT"
JWT="$(getv JWT_SECRET)"

add AUTH_DB_PASSWORD "$(openssl rand -hex 24)"

if [ -z "$(getv SERVICE_ROLE_KEY)" ]; then
  now=$(date +%s); exp=$((now + 315360000))
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '{"role":"service_role","iss":"supabase","iat":%s,"exp":%s}' "$now" "$exp" | b64url)
  s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT" -binary | b64url)
  add SERVICE_ROLE_KEY "$h.$p.$s"
else
  echo "SERVICE_ROLE_KEY: juz ustawiony - pomijam (uwaga: musi byc podpisany obecnym JWT_SECRET)"
fi
