# Obraz serwera gry. Budowanie z głównego folderu repozytorium (potrzebne static/, web/, catalog_export.json):
#   docker build -f server/Dockerfile -t scambox .
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
# rust-embed / include_str! wkompilowują te pliki w exe (src/assets.rs: ../static/, ../../catalog_export.json)
COPY static /src/static
COPY custom_images /src/custom_images
COPY catalog_export.json /src/
COPY --from=web /src/web/dist /src/web/dist
COPY server/ .
# zapytania sqlx::query! sprawdzane z .sqlx/ (cargo sqlx prepare) - bez bazy przy budowaniu
ENV SQLX_OFFLINE=true
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/server/target/release/scambox /usr/local/bin/scambox
COPY static ./static
COPY custom_images ./custom_images
COPY catalog_export.json ./
ENV GAME_DIR=/app BIND=0.0.0.0 PORT=8000 COOKIE_SECURE=1 TRUST_PROXY=1 METRICS_ADDR=127.0.0.1:9100
ENTRYPOINT ["scambox"]
