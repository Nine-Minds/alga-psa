# Dockerfile for using pre-built EE artifacts
# Designed for Argo workflows and CI systems that build separately
# Expects .next, dist, shared/dist to exist locally with EE features included

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
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/
COPY ee/server/package.json ./ee/server/
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

# Copy the shared workspace: pre-built dist AND source. The source is required so
# the appliance tenant bootstrap (npx tsx server/scripts/create-tenant.ts) can
# resolve createTenantComplete -> shared/utils/encryption -> shared/core/getSecret
# at runtime; the webpack app uses shared/dist, but the tsx script reads the source.
COPY ./shared/ ./shared/

# Copy packages directory for webpack aliases
COPY ./packages/ ./packages/

# Appliance onboarding seeds execute in this image after Temporal creates the
# tenant. Fail the build if the runtime exports those seeds import were not
# included by the pre-build pipeline.
RUN test -f /app/packages/core/dist/index.js \
    && test -f /app/packages/db/dist/index.js

# Copy pre-built Next.js artifacts (must exist locally with EE features)
# server/dist is no longer required here; workflow-worker is built/deployed separately
COPY ./server/.next ./server/.next

# Copy runtime files
COPY ./server/public ./server/public
COPY ./server/next.config.mjs ./server/
COPY ./server/knexfile.cjs ./server/
COPY ./server/tsconfig.json ./server/
COPY ./server/index.ts ./server/
COPY ./server/migrations/ ./server/migrations/
COPY ./server/seeds/ ./server/seeds/
COPY ./server/src/ ./server/src/
# server/scripts holds runtime entrypoints invoked at boot, notably
# create-tenant.ts which the appliance bootstrap runs to seed the initial
# tenant/admin. Without it the appliance install fails ERR_MODULE_NOT_FOUND.
COPY ./server/scripts/ ./server/scripts/

# Copy EE-specific files
COPY ./ee/server/src /app/ee/server/src
COPY ./ee/server/migrations/ ./server/migrations/
COPY ./ee/server/seeds/ ./server/seeds/
COPY ./ee/server/seeds/ /app/ee/server/seeds/

# Copy core package.json for version info
COPY packages/core/package.json /app/packages/core/package.json

# Copy the entrypoint with its runtime mode already set. Keeping this as image
# metadata avoids starting a throwaway build container solely to run chmod.
COPY --chmod=0755 server/entrypoint.sh /app/entrypoint.sh

EXPOSE 3000
ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
