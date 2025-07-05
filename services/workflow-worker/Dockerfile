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

# Add shared package as dependency to workflow-worker
WORKDIR /app/services/workflow-worker
RUN npm pkg set dependencies.@alga-psa/shared="file:../../shared"
RUN npm install

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
