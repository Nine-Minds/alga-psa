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
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/ee/package.json ./packages/ee/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY packages/event-schemas/package.json ./packages/event-schemas/
COPY packages/storage/package.json ./packages/storage/
COPY packages/types/package.json ./packages/types/

RUN npm config set legacy-peer-deps true && npm install --include-workspace-root \
  --workspace=@alga-psa/shared \
  --workspace=email-service \
  --workspace=server \
  --workspace=@alga-psa/core \
  --workspace=@alga-psa/db \
  --workspace=@alga-psa/ee-stubs \
  --workspace=@alga-psa/event-bus \
  --workspace=@alga-psa/event-schemas \
  --workspace=@alga-psa/storage \
  --workspace=@alga-psa/types

COPY shared/ ./shared/
COPY server/ ./server/
COPY packages/ ./packages/

WORKDIR /app/packages/core
RUN npm run build && tsc-alias -p tsconfig.json -f --resolve-full-paths

WORKDIR /app/packages/db
RUN npm run build && tsc-alias -p tsconfig.json -f --resolve-full-paths

WORKDIR /app/packages/event-schemas
RUN npm run build

WORKDIR /app/packages/event-bus
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
