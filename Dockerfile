# Dockerfile for using pre-built artifacts
# Designed for Argo workflows and CI systems that build separately
# Expects .next, dist, and shared/dist to exist locally

# Pin to the production-known-good Node runtime. node:alpine floated to Node 26.2.0
# and broke bundled Vault provider initialization in the blue deployment.
FROM node:26.1.0-alpine
RUN apk add --no-cache \
    bash \
    postgresql-client \
    redis \
    graphicsmagick \
    imagemagick \
    ghostscript \
    curl \
    nano \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ffmpeg

# Tell Puppeteer to skip installing Chrome. We'll use the installed chromium.
# Puppeteer's bundled Chrome is glibc-linked and cannot run on Alpine, so
# without this every PDF render fails at browser launch.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/
COPY ee/server/package.json ./ee/server/
COPY ee/packages/workflows/package.json ./ee/packages/workflows/
COPY services/workflow-worker/package.json ./services/workflow-worker/

# Install only production dependencies.
# npm@11 enforces peer dependency resolution more strictly; this image only
# needs runtime deps and should not fail on dev-only peer conflicts.
RUN npm install --omit=dev --legacy-peer-deps

# Copy base files
COPY tsconfig.base.json ./
COPY server/setup /app/server/setup
COPY .env.example /app/.env   
COPY .env.example /app/server/.env  

# Copy pre-built shared workspace (must exist locally)
COPY ./shared/dist/ ./shared/dist/
COPY ./shared/package.json ./shared/package.json

# Copy pre-built Next.js artifacts (must exist locally)
# server/dist is no longer required here; workflow-worker is built/deployed separately
COPY --chown=1000:1000 ./server/.next ./server/.next

# Copy runtime files
COPY ./server/public ./server/public
COPY ./server/next.config.mjs ./server/
COPY ./server/knexfile.cjs ./server/
COPY ./server/tsconfig.json ./server/
COPY ./server/index.ts ./server/
COPY ./server/migrations/ ./server/migrations/
COPY ./server/seeds/ ./server/seeds/
COPY ./server/src/ ./server/src/
COPY ./ee/packages/workflows/ ./ee/packages/workflows/
COPY ./scripts ./scripts
COPY ./shared/workflow/ ./shared/workflow/

# Copy the workspace packages with their pre-built dist directories, as the
# enterprise image does. npm links @alga-psa/* into node_modules from the
# lockfile whether or not the directories exist, so without them every runtime
# import of a workspace package (the file-system secret provider that the
# server, workers and email service share, the admin scripts) fails with
# "Cannot find package" while the webpack bundle, which compiled them in, runs.
COPY ./packages/ ./packages/
RUN test -f /app/packages/core/dist/index.js

# Copy entrypoint
COPY server/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# The image must also run as a non-root user (the browser lane runs it as
# 1000:1000; hardened deployments may too). At runtime the server creates
# logs/ in its working directory for winston's file transport and .next/cache
# for the image optimizer, and Next may rewrite tsconfig.json; a page render
# that cannot create logs/ throws. Give that user the directory, as the old
# test image did.
RUN chown 1000:1000 /app/server /app/server/tsconfig.json

# Create build timestamp for verification
RUN echo "BUILD_TIME=$(date)" > /app/build-info.txt && \
    echo "BUILD_EPOCH=$(date +%s)" >> /app/build-info.txt

EXPOSE 3000

# Environment configuration
ENV NODE_ENV=production

# Secret provider configuration
# Default configuration for composite secret system
# Can be overridden in docker-compose or deployment environments
# See docs/DOCKER_SECRET_PROVIDER_CONFIG.md for details
ENV SECRET_READ_CHAIN="env,filesystem"
ENV SECRET_WRITE_PROVIDER="filesystem"

ENTRYPOINT ["/app/entrypoint.sh"]
