FROM node:20.19-bullseye-slim

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    redis-tools \
    curl \
    bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install global TypeScript and build tools
RUN npm install -g typescript @types/node tsc-alias

# Copy base configuration and root package files for workspace setup
COPY tsconfig.base.json ./
COPY tsconfig.json ./
COPY package.json package-lock.json ./

# Copy all workspace package.json files to set up the dependency tree
COPY ee/packages/workflows/package.json ./ee/packages/workflows/
COPY ee/temporal-workflows/package.json ./ee/temporal-workflows/
COPY packages/ee/package.json ./packages/ee/
COPY shared/package.json ./shared/
COPY services/workflow-worker/package.json ./services/workflow-worker/
COPY server/package.json ./server/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/event-bus/package.json ./packages/event-bus/
COPY packages/event-schemas/package.json ./packages/event-schemas/
COPY packages/formatting/package.json ./packages/formatting/
COPY packages/portal-shared/package.json ./packages/portal-shared/
COPY packages/storage/package.json ./packages/storage/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies for required workspaces (shared, worker, server, and required @alga-psa/* deps)
# Skip puppeteer Chrome download to save disk space
RUN npm config set legacy-peer-deps true && PUPPETEER_SKIP_DOWNLOAD=true npm install --include-workspace-root \
  --workspace=@alga-psa/workflows \
  --workspace=temporal-workflows \
  --workspace=@alga-psa/ee-stubs \
  --workspace=@alga-psa/shared \
  --workspace=workflow-worker \
  --workspace=server \
  --workspace=@alga-psa/core \
  --workspace=@alga-psa/db \
  --workspace=@alga-psa/event-bus \
  --workspace=@alga-psa/event-schemas \
  --workspace=@alga-psa/formatting \
  --workspace=@alga-psa/portal-shared \
  --workspace=@alga-psa/storage \
  --workspace=@alga-psa/types \
  --workspace=@alga-psa/validation \
  --workspace=@alga-psa/email \
  --workspace=@alga-psa/ui \
  && npm install --no-save @temporalio/client@^1.12.3 openai@^4.104.0

# Copy source code for shared + server workspaces
COPY ee/packages/workflows/ ./ee/packages/workflows/
COPY ee/temporal-workflows/ ./ee/temporal-workflows/
COPY ee/server/ ./ee/server/
COPY shared/ ./shared/
COPY server/ ./server/
COPY packages/ ./packages/

# Build core workspace dependencies that export dist artifacts consumed by runtime packages.
WORKDIR /app/packages/core
RUN npm run build

WORKDIR /app/packages/types
RUN npm run build

WORKDIR /app/packages/db
RUN npm run build

WORKDIR /app/packages/formatting
RUN npm run build

WORKDIR /app/packages/validation
RUN npm run build

WORKDIR /app/packages/storage
RUN npm run build

# Build event schemas (required by workflow streams runtime)
WORKDIR /app/packages/event-schemas
RUN npm run build

# Build event bus (required by shared)
WORKDIR /app/packages/event-bus
RUN npm run build

# Build shared workspace first (server is only referenced for type imports)
WORKDIR /app/shared
RUN npm run build

# Build workflow package dist so Temporal-authored modules can resolve runtime exports.
WORKDIR /app/ee/packages/workflows
RUN npm run build

# Build temporal workflows so workflow-worker can host authored queue polling.
WORKDIR /app/ee/temporal-workflows
RUN npm run build

# Copy workflow worker source code and build
WORKDIR /app/services/workflow-worker
COPY services/workflow-worker/ ./
RUN npm run build

# Copy and make entrypoint executable
COPY services/workflow-worker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
