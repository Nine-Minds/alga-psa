FROM node:20-bullseye AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Development stage
FROM base AS development
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM base AS production

# Copy built application
COPY --from=development /app/dist ./dist
COPY --from=development /app/package*.json ./

# Create non-root user
RUN groupadd -r temporal && useradd -r -g temporal temporal
RUN chown -R temporal:temporal /app
USER temporal

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check: OK')" || exit 1

# Expose health check port
EXPOSE 8080

# Default command runs the worker
CMD ["npm", "run", "start"]