FROM node:20.19-alpine

# Install required system dependencies
RUN apk add --no-cache \
    postgresql-client \
    redis \
    curl \
    bash

WORKDIR /app

# Install global TypeScript and build tools
RUN npm install -g typescript @types/node tsc-alias

# Copy base configuration and root package files for workspace setup
COPY tsconfig.base.json ./
COPY package.json package-lock.json ./

# Copy all workspace package.json files to set up the dependency tree
COPY shared/package.json ./shared/
COPY services/workflow-worker/package.json ./services/workflow-worker/
COPY server/package.json ./server/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/

# Install dependencies for required workspaces (shared, worker, server, and required @alga-psa/* deps)
# Skip puppeteer Chrome download to save disk space
RUN npm config set legacy-peer-deps true && PUPPETEER_SKIP_DOWNLOAD=true npm install --include-workspace-root \
  --workspace=@alga-psa/shared \
  --workspace=workflow-worker \
  --workspace=server \
  --workspace=@alga-psa/core \
  --workspace=@alga-psa/db \
  --workspace=@alga-psa/types

# Copy source code for shared + server workspaces
COPY shared/ ./shared/
COPY server/ ./server/
COPY packages/ ./packages/

# Build shared workspace first (server is only referenced for type imports)
WORKDIR /app/shared
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
