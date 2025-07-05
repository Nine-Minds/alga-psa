FROM node:20.9-alpine

# Install required system dependencies
RUN apk add --no-cache \
    postgresql-client \
    redis \
    curl \
    bash

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY services/workflow-worker/package.json ./services/workflow-worker/
COPY server/package.json ./server/
COPY server/src/invoice-templates/assemblyscript ./server/src/invoice-templates/assemblyscript

# Install dependencies
RUN npm install

# Copy shared configuration files
COPY tsconfig.base.json ./

# Copy source code
COPY services/workflow-worker/ ./services/workflow-worker/
COPY shared/ ./shared/

WORKDIR /app/shared
RUN npm run build 

# Create node_modules/@alga-psa directory and symlink shared package
WORKDIR /app/services/workflow-worker
RUN mkdir -p node_modules/@alga-psa && \
    ln -sf ../../../shared node_modules/@alga-psa/shared

WORKDIR /app

# Install TypeScript and other necessary dependencies globally
RUN npm install -g typescript @types/node

# Build the workflow worker
WORKDIR /app/services/workflow-worker
RUN npm run build

WORKDIR /app/services/workflow-worker

# Copy and make entrypoint executable
COPY services/workflow-worker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh


ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
