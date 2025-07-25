# Dockerfile for using pre-built EE artifacts
# Designed for Argo workflows and CI systems that build separately
# Expects .next, dist, shared/dist to exist locally with EE features included

FROM node:alpine
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
    ttf-freefont

# Tell Puppeteer to skip installing Chrome. We'll use the installed chromium.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY ee/server/package.json ./ee/server/

# Install only production dependencies
RUN npm install --omit=dev

# Copy base files
COPY tsconfig.base.json ./
COPY server/setup /app/server/setup
COPY .env.example /app/.env   
COPY .env.example /app/server/.env  

# Copy pre-built shared workspace (must exist locally)
COPY ./shared/dist/ ./shared
COPY ./shared/package.json ./shared/package.json

# Copy pre-built artifacts (must exist locally with EE features)
# These should be built by Argo workflow with build-enterprise.sh
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

# Copy EE-specific files
COPY ./ee/server/src /app/ee/server/src
COPY ./ee/server/migrations/ ./server/migrations/
COPY ./ee/server/seeds/ ./server/seeds/

# Copy entrypoint
COPY server/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create build timestamp for verification
RUN echo "BUILD_TIME=$(date)" > /app/build-info.txt && \
    echo "BUILD_EPOCH=$(date +%s)" >> /app/build-info.txt

EXPOSE 3000
ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]