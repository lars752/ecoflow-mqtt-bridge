ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

WORKDIR /app

# Node.js zur Laufzeit; npm nur für die Installation (reproduzierbar per package-lock.json)
COPY package.json package-lock.json ./
RUN apk add --no-cache nodejs \
    && apk add --no-cache --virtual .build-deps npm \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && apk del .build-deps

COPY src/ ./src/

ENV NODE_ENV=production

# init: false in config.yaml -> Node ist PID 1 und behandelt SIGTERM selbst (sauberer Shutdown)
ENTRYPOINT ["node", "/app/src/index.js"]
