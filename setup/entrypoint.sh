#!/bin/bash

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to handle errors
handle_error() {
    local exit_code=$?
    local last_command=${BASH_COMMAND}
    log "ERROR: Command '$last_command' failed with exit code $exit_code."
    log "Exiting with error code: $exit_code"
    # Exit with the captured exit code
    exit $exit_code
}

# Set up error handling to call handle_error on ERR
# and also exit immediately if a command exits with a non-zero status.
set -e
trap 'handle_error' ERR

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."
    set +e  # Temporarily disable exit on error for the until loop
    until PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U postgres -c '\q' 2>/dev/null; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    set -e  # Re-enable exit on error
    log "PostgreSQL is up and running!"
}

# Function to check if seeds have been run
check_seeds_status() {
    local has_seeds
    has_seeds=$(PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U postgres -d ${DB_NAME_SERVER:-server} -tAc "SELECT EXISTS (SELECT 1 FROM users LIMIT 1);")
    if [ "$has_seeds" = "t" ]; then
        return 0  # Seeds have been run
    else
        return 1  # Seeds haven't been run
    fi
}

# Main setup process
main() {
    wait_for_postgres

    log "Creating database..."
    node /app/server/setup/create_database.js

    log "Creating pgboss schema..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U postgres -d ${DB_NAME_SERVER:-server} -c 'CREATE SCHEMA IF NOT EXISTS pgboss;'

    log "Granting necessary permissions..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U postgres -d ${DB_NAME_SERVER:-server} -c 'GRANT ALL ON SCHEMA public TO postgres;'

    log "Running migrations..."
    
    # For Enterprise Edition, we need to run migrations from a combined directory
    if [ "${EDITION}" = "enterprise" ] || [ "${EDITION}" = "ee" ]; then
        log "Setting up EE migrations..."
        
        # Create a combined migrations directory within /app/server
        mkdir -p /app/server/combined-migrations
        
        # Copy base migrations first (these should run first)
        cp /app/server/migrations/*.cjs /app/server/combined-migrations/ 2>/dev/null || true
        
        # Copy EE migrations (these run after base migrations)
        cp /app/ee/server/migrations/*.cjs /app/server/combined-migrations/ 2>/dev/null || true
        
        # Create a temporary knexfile in /app/server where node_modules exist
        cat > /app/server/knexfile-ee.cjs << 'EOF'
const fs = require('fs');
const path = require('path');

const DOCKER_SECRETS_PATH = '/run/secrets';
const SECRETS_PATH = DOCKER_SECRETS_PATH;

function getSecret(secretName, envVar, defaultValue = '') {
  const secretPath = path.join(SECRETS_PATH, secretName);
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (error) {
    if (process.env[envVar]) {
      return process.env[envVar] || defaultValue;
    }
    return defaultValue;
  }
}

module.exports = {
  migration: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'postgres',
      port: process.env.DB_PORT || '5432',
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: getSecret('postgres_password', 'DB_PASSWORD_ADMIN'),
      database: process.env.DB_NAME_SERVER || 'server',
    },
    pool: {
      min: 2,
      max: 20,
    },
    migrations: {
      directory: './combined-migrations'
    }
  }
};
EOF
        
        log "Running combined migrations for EE..."
        cd /app/server && NODE_ENV=migration npx knex migrate:latest --knexfile knexfile-ee.cjs || {
            log "ERROR: EE migrations failed"
            exit 1
        }
        log "EE migrations completed!"
        
        # Clean up
        rm -rf /app/server/combined-migrations
        rm -f /app/server/knexfile-ee.cjs
    else
        # For CE, just run the base migrations
        NODE_ENV=migration npx knex migrate:latest --knexfile /app/server/knexfile.cjs || {
            log "ERROR: Migrations failed"
            exit 1
        }
        log "Migrations completed!"
    fi

    # Check if seeds need to be run
    if ! check_seeds_status; then
        log "Running seeds..."
        NODE_ENV=migration npx knex seed:run --knexfile /app/server/knexfile.cjs || {
            log "Seeds failed, but continuing since database may already be seeded"
        }
        log "Seeds completed!"
    else
        log "Seeds have already been run, skipping..."
    fi

    log "Setup completed!"
    log "Exiting with success code: 0"
    exit 0
}

# Execute main function
main
