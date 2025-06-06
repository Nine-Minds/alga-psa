FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during the build
ENV NEXT_TELEMETRY_DISABLED=1

# Enable source map generation for production
ENV GENERATE_SOURCEMAP=1

RUN npm run build

# Create build info file with timestamp and git commit info
RUN echo "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /app/build-info.txt && \
    echo "BUILD_EPOCH=$(date +%s)" >> /app/build-info.txt

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static files including source maps
# The standalone output doesn't include source maps, so we copy the entire static directory
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy build info file for version tracking
COPY --from=builder --chown=nextjs:nodejs /app/build-info.txt ./build-info.txt

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run the Next.js standalone server directly
CMD ["node", "server.js"]