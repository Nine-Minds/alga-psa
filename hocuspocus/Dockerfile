FROM node:22.5.1 AS builder

WORKDIR /app/hocuspocus

# Hocuspocus is a standalone package with its own lockfile; installing from the
# repo root pulls unrelated workspace deps and breaks the prebuilt CE path.
COPY hocuspocus/package.json ./package.json
COPY hocuspocus/package-lock.json ./package-lock.json
RUN npm ci --omit=dev

FROM node:22.5.1-slim

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    redis-tools \
    curl \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/hocuspocus

# Create a non-root user
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

# Copy built node modules and service source files only.
COPY --from=builder /app/hocuspocus/node_modules ./node_modules
COPY hocuspocus/ ./

# Set up entrypoint script
RUN chmod +x ./entrypoint.sh

# Set ownership to the non-root user
RUN chown -R nodejs:nodejs /app

# The entrypoint starts as root so it can read Docker secret files that are
# intentionally chmod 600 on the host, then drops to nodejs before launching
# the Hocuspocus Node process.

EXPOSE 1234

ENTRYPOINT ["./entrypoint.sh"]
