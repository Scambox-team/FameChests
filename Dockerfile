# Obraz serwera gry. Kontekst budowania = katalog główny repozytorium (potrzebne static/, web/, seed/):
#   docker build -t scambox .
# Uruchomienie: DATABASE_URL, SECRET_KEY, DATA_DIR (wolumen na zdjęcia), port 8000.
# cargo-chef: zależności budują się w osobnej warstwie - zmiana samego kodu nie kompiluje ich od nowa.
FROM node:24-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM lukemathwalker/cargo-chef:latest-rust-1-bookworm AS chef
WORKDIR /src/server

FROM chef AS planner
COPY server/ .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS build
COPY --from=planner /src/server/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
# rust-embed / include_str! wkompilowują te pliki w exe (src/assets.rs: ../static/, ../seed/custom_images/, ../../seed/catalog_export.json)
COPY static /src/static
COPY seed /src/seed
# poziomy Pinballa: te same dane ma przeglądarka, a serwer odtwarza na nich gry (src/pinball_sim.rs: ../../web/src/features/pinball/levels.json)
COPY web/src/features/pinball/levels.json /src/web/src/features/pinball/levels.json
COPY --from=web /src/web/dist /src/web/dist
COPY server/ .
# zapytania sqlx::query! sprawdzane z .sqlx/ (cargo sqlx prepare) - bez bazy przy budowaniu
ENV SQLX_OFFLINE=true
RUN cargo build --release

FROM debian:bookworm-slim
# pg_dump do kopii zapasowych z panelu (src/backup.rs) - z repozytorium PostgreSQL, ta sama wersja (17) co baza Supabase
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/server/target/release/scambox /usr/local/bin/scambox
COPY static ./static
COPY seed ./seed
ENV GAME_DIR=/app BIND=0.0.0.0 PORT=8000 COOKIE_SECURE=1 TRUST_PROXY=1 METRICS_ADDR=127.0.0.1:9100
ENTRYPOINT ["scambox"]
