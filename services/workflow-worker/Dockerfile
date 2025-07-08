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

# Copy base configuration
COPY tsconfig.base.json ./

# First, handle shared package dependencies
WORKDIR /app/shared
COPY shared/package.json ./
RUN npm install

# Copy shared source code
COPY shared/ ./

# Build shared
RUN npm run build

# Now handle workflow worker dependencies
WORKDIR /app/services/workflow-worker
COPY services/workflow-worker/package.json ./
RUN npm install

# Copy workflow worker source code
COPY services/workflow-worker/ ./

# Build the workflow worker
RUN npm run build

# Copy and make entrypoint executable
COPY services/workflow-worker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
