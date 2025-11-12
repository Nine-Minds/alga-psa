FROM node:20.9-alpine

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

# Install dependencies for required workspaces (shared, worker, server)
RUN npm install --workspace=shared --workspace=services/workflow-worker --workspace=server

# Copy source code for shared + server workspaces
COPY shared/ ./shared/
COPY server/ ./server/

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
