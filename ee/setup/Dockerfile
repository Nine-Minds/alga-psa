FROM node:latest

WORKDIR /app/setup

# Install database clients and utilities
RUN apt-get update && apt-get install -y \
    postgresql-client \
    default-mysql-client \
    sqlite3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy setup files
COPY setup/entrypoint.sh ./
COPY setup/config.ini ./config.ini
COPY ee/setup/entrypoint.sh ./ee-entrypoint.sh

# Copy and build shared dependencies
COPY tsconfig.base.json ../tsconfig.base.json
COPY shared/package.json ../shared/package.json
COPY shared/tsconfig.json ../shared/tsconfig.json
COPY shared/ ../shared
WORKDIR /app/shared
RUN npm install && npm run build

# Return to setup workdir and copy server files
WORKDIR /app/setup
COPY server/package.json /app/server/
COPY server/setup/create_database.js /app/server/setup/
COPY server/knexfile.cjs /app/server/

# Copy CE migrations and seeds to separate directories
COPY server/migrations /app/server/migrations-ce
COPY server/seeds /app/server/seeds-ce

# Copy EE migrations to separate directory
COPY ee/server/migrations /app/server/migrations-ee

# Create empty EE seeds directory (EE currently has no custom seeds)
RUN mkdir -p /app/server/seeds-ee

# Make entrypoint scripts executable
RUN chmod +x ./entrypoint.sh
RUN chmod +x ./ee-entrypoint.sh

WORKDIR /app
COPY server/src/invoice-templates/assemblyscript ./server/src/invoice-templates/assemblyscript

# Install dependencies
WORKDIR /app/server
RUN npm install --no-optional
RUN npm install -g knex
RUN npm install pg knex dotenv pg-boss

# Install pg-boss in setup directory
WORKDIR /app/setup
RUN npm init -y && npm install pg-boss

# Add type:module to package.json for ES modules support
RUN node -e "const pkg=require('./package.json'); pkg.type='module'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2))"

WORKDIR /app/setup

# Set the EE entrypoint script
ENTRYPOINT ["./ee-entrypoint.sh"]
