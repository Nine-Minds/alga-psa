FROM node:alpine AS server

# Build argument to control edition
ARG EXCLUDE_EE=false

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
COPY ee/server/package.json ./ee/server/
COPY scripts/ ./scripts/

# Install dependencies (cached unless package files change)

COPY server/src/invoice-templates/assemblyscript ./server/src/invoice-templates/assemblyscript

RUN npm install && \
    cd server/src/invoice-templates/assemblyscript && \
    npm install && \
    cd /app

COPY tsconfig.base.json ./

WORKDIR /app
COPY shared/ ./shared/
COPY services/ ./services/

# Copy EE features conditionally
COPY ee/ ./ee/
RUN if [ "$EXCLUDE_EE" = "true" ]; then \
        echo "Building CE edition - excluding EE features..."; \
        rm -rf ./ee; \
    else \
        echo "Including EE features..."; \
    fi

WORKDIR /app/server

# Copy server source code
COPY server/ ./
COPY scripts/ ./scripts/

ENV NEXT_PUBLIC_EDITION=enterprise
RUN ./scripts/build-enterprise.sh

# Clean any existing build artifacts and build the Next.js application
RUN rm -rf .next && npm run build

# Copy and make entrypoint executable (rarely changes)
COPY server/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
ENV NODE_ENV=production
ENTRYPOINT ["/app/entrypoint.sh"]

