#!/bin/sh
# Kopiuje folder danych gry (DATA_DIR z Azure: image_cache/ ze zdjęciami, także wgranymi przez admina)
# do wolumenu gry. Folder pobierzesz z Kudu: https://<aplikacja>.scm.azurewebsites.net/api/zip/data/
# (zip z /home/data - rozpakuj go).
#
#   sh import-data.sh ./data
set -e
cd "$(dirname "$0")"
DIR="$1"
[ -d "$DIR" ] || { sed -n '2,6p' "$0"; exit 1; }
DIR=$(cd "$DIR" && pwd)

docker compose stop game 2>/dev/null || true
docker compose run --rm --no-deps -v "$DIR:/import:ro" --entrypoint sh game \
    -c 'cp -a /import/. /data/ && du -sh /data'
echo "Gotowe. Uruchom grę:  docker compose up -d game"
