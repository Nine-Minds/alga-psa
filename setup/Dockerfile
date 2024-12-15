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

# Copy server files
COPY server/package.json /app/server/
COPY server/package-lock.json /app/server/
COPY server/setup/create_database.js /app/server/setup/
COPY server/knexfile.cjs /app/server/
COPY server/migrations /app/server/migrations
COPY server/seeds /app/server/seeds

# Make entrypoint script executable
RUN chmod +x ./entrypoint.sh

# Install dependencies
WORKDIR /app/server
RUN npm install
RUN npm install -g knex
RUN npm install pg knex dotenv pg-boss

# Install pg-boss in setup directory
WORKDIR /app/setup
RUN npm init -y && npm install pg-boss

# Add type:module to package.json for ES modules support
RUN node -e "const pkg=require('./package.json'); pkg.type='module'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2))"

WORKDIR /app/setup

# Set the entrypoint script
ENTRYPOINT ["./entrypoint.sh"]
