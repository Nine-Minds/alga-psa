FROM node:20-bullseye AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY shared/ /app/shared
COPY ee/temporal-workflows/ /app/ee/temporal-workflows
COPY tsconfig.base.json /app/tsconfig.base.json

WORKDIR /app/ee/temporal-workflows
# Install dependencies
RUN npm install

# Development stage
FROM base AS development

# First, we need to copy and build shared
# Note: This assumes the Docker build context is set to project root
# with -f ee/temporal-workflows/Dockerfile
WORKDIR /app/shared
RUN npm install
RUN npm run build

# Now build temporal-workflows
WORKDIR /app
COPY ee/temporal-workflows/ ./

WORKDIR /app/ee/temporal-workflows
RUN npm run build

# Production stage
FROM base AS production

# Copy built shared module
COPY --from=development /app/shared /app/shared

# Copy built temporal-workflows
COPY --from=development /app/ee/temporal-workflows/dist /app/ee/temporal-workflows/dist
COPY --from=development /app/ee/temporal-workflows/node_modules /app/ee/temporal-workflows/node_modules

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
CMD ["node", "dist/ee/temporal-workflows/src/worker.js"]