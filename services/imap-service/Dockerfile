FROM node:20.19-alpine

RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash

WORKDIR /app

RUN npm install -g typescript @types/node tsc-alias

COPY tsconfig.base.json ./
COPY types/ ./types/
COPY package.json package-lock.json ./

COPY shared/package.json ./shared/
COPY services/imap-service/package.json ./services/imap-service/
COPY server/package.json ./server/

RUN npm config set legacy-peer-deps true && npm install --workspace=shared --workspace=services/imap-service --workspace=server

COPY shared/ ./shared/
COPY server/ ./server/
COPY packages/ ./packages/

WORKDIR /app/packages/core
RUN npm run build && tsc-alias -p tsconfig.json -f --resolve-full-paths

WORKDIR /app/packages/db
RUN npm run build && tsc-alias -p tsconfig.json -f --resolve-full-paths

WORKDIR /app/packages/event-schemas
RUN npm run build

WORKDIR /app/shared
RUN npm run build

WORKDIR /app/services/imap-service
COPY services/imap-service/ ./
RUN npm run build

COPY services/imap-service/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
