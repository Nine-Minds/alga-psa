FROM node:20-alpine AS base

# Install Helm CLI
RUN apk add --no-cache curl bash \
  && curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

FROM base AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM base AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy the Helm chart so it's available at runtime
COPY --from=builder /app/../helm /helm

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV TRIAL_HELM_CHART_PATH=/helm

CMD ["node", "server.js"]
