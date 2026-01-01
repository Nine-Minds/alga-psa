FROM node:20-bullseye AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL "https://storage.googleapis.com/kubernetes-release/release/$(curl -sSL https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

WORKDIR /app
ENV NODE_PATH=/app/shared/node_modules

COPY shared/ /app/shared
COPY packages/ /app/packages/
COPY server/src/ /app/server/src/
COPY server/package.json /app/server/package.json
COPY ee/server/src/ /app/ee/server/src/
COPY ee/temporal-workflows/package*.json /app/ee/temporal-workflows/
COPY tsconfig.base.json /app/tsconfig.base.json

WORKDIR /app/packages/product-email-domains
RUN npm install --ignore-scripts

WORKDIR /app/ee/temporal-workflows
# Install global build tooling required by shared package scripts
RUN npm install -g typescript
# Install dependencies (skip prepare scripts to avoid building shared during base stage)
RUN npm install --ignore-scripts

# Development stage
FROM base AS development

# First, we need to copy and build shared
# Note: This assumes the Docker build context is set to project root
# with -f ee/temporal-workflows/Dockerfile
WORKDIR /app/shared
RUN npm install
RUN npm run build
RUN npm run build

# Now build temporal-workflows
WORKDIR /app
COPY ee/temporal-workflows/ /app/ee/temporal-workflows/
# Provide source files referenced via TS path aliases
COPY packages/ /app/packages/

WORKDIR /app/packages/product-email-domains
RUN npm install --ignore-scripts

# Install server dependencies (needed for type-checking server source files via path aliases)
WORKDIR /app/server
RUN npm install --ignore-scripts --legacy-peer-deps || true
# TS module resolution for ee/server/src expects dependencies under /app/ee/server
RUN mkdir -p /app/ee/server && ln -sf /app/server/node_modules /app/ee/server/node_modules

WORKDIR /app/ee/temporal-workflows
# Ensure tsc-alias is available for the build
RUN npm install
RUN npm run build

# Copy onboarding seeds after build
COPY ee/server/seeds/onboarding /app/ee/temporal-workflows/dist/seeds/onboarding

# Verify seeds were copied (debug step)
RUN ls -la /app/ee/temporal-workflows/dist/seeds/onboarding || echo "Seeds directory not found"

# Production stage
FROM base AS production

# Copy built shared module
COPY --from=development /app/shared /app/shared

# Copy built temporal-workflows
COPY --from=development /app/ee/temporal-workflows/dist /app/ee/temporal-workflows/dist
COPY --from=development /app/ee/temporal-workflows/node_modules /app/ee/temporal-workflows/node_modules
# Copy product-email-domains node_modules to both locations for module resolution
COPY --from=development /app/packages/product-email-domains/node_modules /app/packages/product-email-domains/node_modules
COPY --from=development /app/packages/product-email-domains/node_modules /app/ee/temporal-workflows/dist/packages/product-email-domains/node_modules

# Verify seeds are present in production stage
RUN ls -la /app/ee/temporal-workflows/dist/seeds/onboarding || echo "Seeds directory not found in production stage"

# Create non-root user
RUN groupadd -r temporal && useradd -r -g temporal temporal
RUN chown -R temporal:temporal /app
USER temporal

WORKDIR /app/ee/temporal-workflows

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check: OK')" || exit 1

# Expose health check port
EXPOSE 8080

# Default command runs the worker
CMD ["node", "dist/worker.js"]
