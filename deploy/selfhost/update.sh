#!/bin/sh
# Aktualizacja gry na serwerze - bezpieczna: kopia bazy przed zmianą, sprawdzenie, że nowa wersja działa,
# a jeśli nie wstanie - sam powrót do poprzedniej.
#
#   sh update.sh          aktualizuj teraz
#   sh update.sh --auto   tylko gdy jest nowa wersja (do crona, README.md: "Aktualizacje")
#
# Obraz gry (GAME_IMAGE w .env):
#   ghcr.io/scambox-team/famechests:latest  - gotowy z GitHuba (CI buduje go po każdym pushu do main): docker compose pull
#   scambox:local                           - budowany tutaj z repozytorium: git pull + docker compose build
# Kroki: git pull -> nowy obraz -> czy coś się zmieniło? -> kopia bazy -> start -> sprawdzenie (healthcheck) -> ewentualny powrót.
set -eu
cd "$(dirname "$0")"

AUTO=0
[ "${1:-}" = "--auto" ] && AUTO=1
log() { echo "[$(date '+%F %T')] $*"; }
[ -f .env ] || { log "Brak .env - najpierw sh setup.sh"; exit 1; }

# jedna aktualizacja naraz (cron + ręczne uruchomienie)
if command -v flock >/dev/null 2>&1; then
    exec 9>.update.lock
    flock -n 9 || { log "Aktualizacja już trwa"; exit 1; }
fi

IMAGE=$(grep '^GAME_IMAGE=' .env | cut -d= -f2- | tr -d '\r' || true)
IMAGE=${IMAGE:-scambox:local}
WAIT=${UPDATE_WAIT_SECONDS:-600}   # ile czekać, aż nowa wersja odpowie (pierwszy start bywa długi)

# 1. kod i ustawienia compose z GitHuba (.env i dane są poza gitem - nie zmieniają się)
OLD_HEAD=$(git rev-parse HEAD)
if ! git pull -q --ff-only; then
    log "git pull nie przeszedł (lokalne zmiany w plikach z repozytorium?) - przerywam"
    exit 1
fi
NEW_HEAD=$(git rev-parse HEAD)
[ "$OLD_HEAD" != "$NEW_HEAD" ] && log "Nowy kod: $(git log --oneline -1)"

# 2. nowy obraz gry. Obecny oznaczamy PRZED pobraniem: pull przenosi etykietę na nowy obraz, a stary bez etykiety
#    bywa od razu usuwany (Docker z magazynem containerd) - nie byłoby do czego wrócić
CUR=$(docker inspect -f '{{.Image}}' scambox-game 2>/dev/null || true)
ROLLBACK=0
if [ -n "$CUR" ]; then
    if docker tag "$CUR" scambox:rollback 2>/dev/null; then
        ROLLBACK=1
    elif [ "$AUTO" = 1 ]; then
        # np. ktoś ręcznie przebudował / pobrał obraz i stary zniknął - bez możliwości powrotu nie ryzykujemy z crona
        log "Nie ma już obrazu, na którym działa gra - nie byłoby do czego wrócić. Zaktualizuj ręcznie: sh update.sh"
        exit 1
    else
        log "UWAGA: nie ma już obrazu, na którym działa gra - jeśli nowa wersja nie wstanie, nie będzie powrotu"
    fi
fi
case "$IMAGE" in
    */*)
        log "Pobieram $IMAGE"
        docker compose pull -q game ;;
    *)
        if [ "$AUTO" = 0 ] || [ "$OLD_HEAD" != "$NEW_HEAD" ] || [ -z "$CUR" ]; then
            log "Buduję obraz z repozytorium (to potrwa kilka minut)"
            docker compose build -q game
        fi ;;
esac
NEW=$(docker image inspect -f '{{.Id}}' "$IMAGE")

if [ "$NEW" = "$CUR" ] && [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
    log "Brak nowej wersji - nic nie zmieniam"
    exit 0
fi
# wersja, która już raz nie wstała: cron jej nie ponawia (gra nie leżałaby co noc); ręcznie: sh update.sh
if [ "$AUTO" = 1 ] && [ "$NEW" = "$(cat .update.failed 2>/dev/null || true)" ]; then
    log "Ta wersja już raz nie wstała - pomijam (ręcznie: sh update.sh)"
    exit 0
fi

# 3. kopia bazy przed zmianą (bez niej nie aktualizujemy) - w panelu jako "Przed aktualizacją", gra trzyma
#    GAME_BACKUP_KEEP najnowszych. Najpierw .part, potem zmiana nazwy (niepełny plik nie udaje kopii)
if [ -n "$CUR" ] && [ "$(docker inspect -f '{{.State.Running}}' scambox-game 2>/dev/null)" = "true" ]; then
    log "Kopia bazy przed aktualizacją"
    docker compose exec -T game sh -c \
        'f="/backups/update-$(date +%Y%m%d-%H%M%S).dump" && \
         pg_dump "$DATABASE_URL" --schema="${DB_SCHEMA:-public}" --format=custom --no-owner --no-privileges -f "$f.part" && \
         mv "$f.part" "$f"' \
        || { log "Kopia bazy nie powiodła się - nie aktualizuję"; exit 1; }
fi

# 4. start nowej wersji i czekanie, aż odpowiada (healthcheck z docker-compose.override.yml)
log "Uruchamiam nową wersję i czekam, aż odpowie (do $WAIT s)"
if docker compose up -d --no-build --wait --wait-timeout "$WAIT" game; then
    rm -f .update.failed
    docker image prune -f >/dev/null 2>&1 || true   # stare, nieoznaczone obrazy
    log "Gotowe: gra działa na nowej wersji ($(docker image inspect -f '{{.Created}}' "$IMAGE" | cut -c1-19))"
    exit 0
fi

# 5. nowa wersja nie wstała - powrót
echo "$NEW" > .update.failed
log "NOWA WERSJA NIE DZIAŁA - ostatnie logi:"
docker compose logs --tail 30 game || true
if [ "$ROLLBACK" = 1 ]; then
    log "Wracam do poprzedniej wersji"
    docker tag scambox:rollback "$IMAGE"
    if docker compose up -d --no-build --wait --wait-timeout "$WAIT" game; then
        log "Poprzednia wersja działa. Dane: kopia sprzed aktualizacji jest w backups/game/"
    else
        log "Poprzednia wersja też nie wstała - sprawdź: docker compose logs game"
    fi
fi
exit 1
