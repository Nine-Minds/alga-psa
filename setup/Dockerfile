FROM node:latest

WORKDIR /app

# Install database clients and utilities
RUN apt-get update && apt-get install -y \
    postgresql-client \
    default-mysql-client \
    sqlite3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files for workspace setup
COPY package.json package-lock.json tsconfig.base.json ./

# Copy all workspace package.json files
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Copy shared source and build it
# Copy shared source and build it
COPY shared/ ./shared/
WORKDIR /app/shared
RUN npm install && npm run build

WORKDIR /app

# Copy server setup files (must be executed from /app)
COPY server/setup/create_database.js ./server/setup/
COPY server/knexfile.cjs ./server/
COPY server/migrations ./server/migrations
COPY server/seeds ./server/seeds
COPY server/src/invoice-templates/assemblyscript ./server/src/invoice-templates/assemblyscript

# Install all dependencies from root to properly set up workspaces
WORKDIR /app
RUN npm install --workspaces --no-optional

# Install additional tools
RUN npm install -g knex

# Copy setup files
WORKDIR /app/setup
COPY setup/entrypoint.sh ./
COPY setup/config.ini ./config.ini
RUN chmod +x ./entrypoint.sh

# Install pg-boss in setup directory
WORKDIR /app/setup
RUN npm init -y && npm install pg-boss

# Add type:module to package.json for ES modules support
RUN node -e "const pkg=require('./package.json'); pkg.type='module'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2))"

WORKDIR /app/setup

# Set the entrypoint script
ENTRYPOINT ["./entrypoint.sh"]
