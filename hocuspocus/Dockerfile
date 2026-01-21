FROM node:22.5.1 AS builder

WORKDIR /app/hocuspocus

COPY package.json ./
RUN npm install --omit=dev --no-package-lock

FROM node:22.5.1-slim

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    redis-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/hocuspocus

# Create a non-root user
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

# Copy built node modules and source files
COPY --from=builder /app/hocuspocus/node_modules ./node_modules
COPY . ./

# Set up entrypoint script
RUN chmod +x ./entrypoint.sh

# Set ownership to the non-root user
RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 1234

ENTRYPOINT ["./entrypoint.sh"]
