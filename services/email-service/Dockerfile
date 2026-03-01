FROM node:20.19-alpine

RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash

WORKDIR /app

RUN npm install -g typescript @types/node tsc-alias

COPY tsconfig.base.json ./
COPY tsconfig.json ./
COPY types/ ./types/
COPY package.json package-lock.json ./

COPY shared/package.json ./shared/
COPY services/email-service/package.json ./services/email-service/
COPY server/package.json ./server/
COPY packages/storage/package.json ./packages/storage/

RUN npm config set legacy-peer-deps true && npm install --workspace=shared --workspace=services/email-service --workspace=server --workspace=packages/storage

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

WORKDIR /app/packages/storage
RUN npm run build

WORKDIR /app/services/email-service
COPY services/email-service/ ./
RUN npm run build

COPY services/email-service/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
