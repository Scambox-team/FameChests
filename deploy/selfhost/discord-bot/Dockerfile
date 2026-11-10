# Bot Discorda ScamBox. Budowanie: docker compose build discord-bot (kontekst = ten katalog)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium
# Chromium rysuje karty (komenda /karta, ogłoszenia o dropach); emoji i fonty, bo karty mają ikony typów i ataków
RUN apk add --no-cache chromium font-noto-emoji ttf-freefont fontconfig
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# stan bota (id kanałów i wiadomości, które sam edytuje) - wolumen, żeby po restarcie nie dublował wpisów
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "src/index.js"]
