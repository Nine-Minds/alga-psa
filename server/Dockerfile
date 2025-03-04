FROM node:20.9-alpine AS server

# Install required system dependencies (rarely changes)
RUN apk add --no-cache \
    graphicsmagick \
    imagemagick \
    ghostscript \
    postgresql-client \
    redis \
    curl \
    bash

WORKDIR /app

# Copy only package files first for npm install
COPY package.json package-lock.json ./
COPY server/package.json ./server/

# Install dependencies (cached unless package files change)
RUN npm install

COPY tsconfig.base.json ./

WORKDIR /app
COPY shared/ ./shared/

WORKDIR /app/server

# Copy server source code (changes frequently)
COPY server/ ./

# Copy and make entrypoint executable (rarely changes)
COPY server/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]
