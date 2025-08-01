# Dockerfile for using pre-built artifacts
# Designed for Argo workflows and CI systems that build separately
# Expects .next, dist, and shared/dist to exist locally

FROM node:alpine
RUN apk add --no-cache \
    bash \
    postgresql-client \
    redis \
    graphicsmagick \
    imagemagick \
    ghostscript \
    curl \
    nano

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY server/package.json ./server/

# Install only production dependencies
RUN npm install --omit=dev

# Copy base files
COPY tsconfig.base.json ./
COPY server/setup /app/server/setup
COPY .env.example /app/.env   
COPY .env.example /app/server/.env  

# Copy pre-built shared workspace (must exist locally)
COPY ./shared/dist/ ./shared/dist/
COPY ./shared/package.json ./shared/package.json

# Copy pre-built artifacts (must exist locally)
# These should be built by Argo workflow or separate build step
COPY ./server/.next ./server/.next
COPY ./server/dist ./server/dist

# Copy runtime files
COPY ./server/public ./server/public
COPY ./server/next.config.mjs ./server/
COPY ./server/knexfile.cjs ./server/
COPY ./server/tsconfig.json ./server/
COPY ./server/index.ts ./server/
COPY ./server/migrations/ ./server/migrations/
COPY ./server/seeds/ ./server/seeds/
COPY ./server/src/ ./server/src/

# Copy entrypoint
COPY server/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

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