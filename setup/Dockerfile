FROM node:latest

WORKDIR /app

# Install database clients using apt
RUN apt-get update && apt-get install -y \
    postgresql-client \
    default-mysql-client \
    sqlite3

# Copy necessary files
COPY setup/bash/log.sh /app/log.sh
COPY setup/bash/entrypoint.sh /app/entrypoint.sh
COPY server/package.json /app/package.json
COPY server/setup/create_database.js /app/server/setup/create_database.js
COPY server/knexfile.cjs /app/knexfile.cjs

# Copy migrations and seeds
COPY server/migrations /app/migrations
COPY server/seeds /app/seeds

# Make scripts executable
RUN chmod +x /app/entrypoint.sh /app/log.sh

# Install dependencies
RUN npm install
RUN npm install -g knex
RUN npm install pg knex dotenv

# Create .env file with database configuration
RUN echo "DB_HOST=postgres\n\
DB_PORT=5432\n\
DB_USER_ADMIN=postgres\n\
DB_PASSWORD_ADMIN=abcd1234!\n\
DB_NAME_SERVER=server\n\
DB_USER_SERVER=server_user\n\
DB_PASSWORD_SERVER=abcd1234!\n\
APP_ENV=development\n\
DB_TYPE=postgres" > /app/.env

# Add type:module to package.json for ES modules support
RUN node -e "const pkg=require('./package.json'); pkg.type='module'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2))"

WORKDIR /app
