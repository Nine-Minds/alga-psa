FROM node:20.19-alpine AS builder

WORKDIR /app

COPY services/ai-gateway/package.json services/ai-gateway/package-lock.json ./
RUN npm ci

COPY tsconfig.base.json /tsconfig.base.json
COPY services/ai-gateway/tsconfig.json ./
COPY services/ai-gateway/src ./src
RUN npm run build

FROM node:20.19-alpine AS runtime

RUN apk add --no-cache postgresql-client

WORKDIR /app

COPY services/ai-gateway/package.json services/ai-gateway/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY services/ai-gateway/knexfile.cjs ./
COPY services/ai-gateway/migrations ./migrations
COPY services/ai-gateway/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
