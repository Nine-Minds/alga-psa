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
    # Use DB_HOST_ADMIN for direct postgres connections (admin operations)
    # Fall back to DB_HOST if not set, then to 'postgres'
    local PG_ADMIN_HOST=${DB_HOST_ADMIN:-${DB_HOST:-postgres}}
    local PG_ADMIN_PORT=${DB_PORT_ADMIN:-${DB_PORT:-5432}}
    # If host points at PgBouncer, prefer talking to Postgres directly for setup
    if [ "$PG_ADMIN_HOST" = "pgbouncer" ]; then
        log "Detected DB_HOST pointing to PgBouncer; using direct Postgres for admin ops"
        PG_ADMIN_HOST=postgres
        PG_ADMIN_PORT=5432
        export DB_HOST_ADMIN=$PG_ADMIN_HOST
        export DB_PORT_ADMIN=$PG_ADMIN_PORT
    fi
    local PG_PASSWORD=$(cat /run/secrets/postgres_password | tr -d '[:space:]')
    set +e  # Temporarily disable exit on error for the until loop
    until PGPASSWORD="${PG_PASSWORD}" psql -h ${PG_ADMIN_HOST} -p ${PG_ADMIN_PORT} -U postgres -c '\q' 2>/dev/null; do
        # Try direct Postgres as a smart fallback if PgBouncer is the target and not responding
        if [ "$PG_ADMIN_HOST" != "postgres" ] && PGPASSWORD="${PG_PASSWORD}" pg_isready -h postgres -p 5432 -U postgres >/dev/null 2>&1; then
            log "PgBouncer not ready but Postgres is reachable; switching admin host to Postgres"
            PG_ADMIN_HOST=postgres
            PG_ADMIN_PORT=5432
            export DB_HOST_ADMIN=$PG_ADMIN_HOST
            export DB_PORT_ADMIN=$PG_ADMIN_PORT
            continue
        fi
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    set -e  # Re-enable exit on error
    log "PostgreSQL is up and running!"
}

# Function to check if seeds have been run
check_seeds_status() {
    local has_seeds
    # Use DB_HOST_ADMIN for direct postgres connections (admin operations)
    local PG_ADMIN_HOST=${DB_HOST_ADMIN:-${DB_HOST:-postgres}}
    local PG_ADMIN_PORT=${DB_PORT_ADMIN:-${DB_PORT:-5432}}
    local PG_PASSWORD=$(cat /run/secrets/postgres_password 2>/dev/null | tr -d '[:space:]')

    # If reading from secrets failed, try environment variable
    if [ -z "$PG_PASSWORD" ]; then
        log "WARNING: Could not read password from secrets file in check_seeds_status, trying environment variable"
        PG_PASSWORD="${DB_PASSWORD_ADMIN}"
    fi

    has_seeds=$(PGPASSWORD="${PG_PASSWORD}" psql -h ${PG_ADMIN_HOST} -p ${PG_ADMIN_PORT} -U postgres -d ${DB_NAME_SERVER:-server} -tAc "SELECT EXISTS (SELECT 1 FROM users LIMIT 1);" 2>/dev/null)
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

    # Use DB_HOST_ADMIN for direct postgres connections (admin operations)
    # pgbouncer doesn't support certain admin commands
    local PG_ADMIN_HOST=${DB_HOST_ADMIN:-${DB_HOST:-postgres}}
    local PG_ADMIN_PORT=${DB_PORT_ADMIN:-${DB_PORT:-5432}}
    # Read and trim the postgres password (be extra careful with whitespace)
    local PG_PASSWORD=$(cat /run/secrets/postgres_password 2>/dev/null | tr -d '[:space:]')

    # If reading from secrets failed, try environment variable
    if [ -z "$PG_PASSWORD" ]; then
        log "WARNING: Could not read password from secrets file, trying environment variable"
        PG_PASSWORD="${DB_PASSWORD_ADMIN}"
    fi

    log "DEBUG: Connecting to ${PG_ADMIN_HOST}:${PG_ADMIN_PORT} with user postgres"
    log "DEBUG: Password available: $([ -n "$PG_PASSWORD" ] && echo 'yes' || echo 'no')"
    log "DEBUG: Password length: ${#PG_PASSWORD}"

    log "Creating pgboss schema..."
    # Add retry logic for pgboss schema creation in case of temporary connection issues
    local RETRY_COUNT=0
    local MAX_RETRIES=3
    local RETRY_DELAY=2

    until PGPASSWORD="${PG_PASSWORD}" psql -h ${PG_ADMIN_HOST} -p ${PG_ADMIN_PORT} -U postgres -d ${DB_NAME_SERVER:-server} -c 'CREATE SCHEMA IF NOT EXISTS pgboss;' 2>&1; do
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
            log "ERROR: Failed to create pgboss schema after $MAX_RETRIES attempts"
            log "Testing connection with psql..."
            PGPASSWORD="${PG_PASSWORD}" psql -h ${PG_ADMIN_HOST} -p ${PG_ADMIN_PORT} -U postgres -d ${DB_NAME_SERVER:-server} -c 'SELECT version();' 2>&1 || log "Connection test failed"
            log "Checking if Postgres is still accessible..."
            pg_isready -h ${PG_ADMIN_HOST} -p ${PG_ADMIN_PORT} -U postgres || log "Postgres not ready"
            exit 1
        fi
        log "Retry $RETRY_COUNT/$MAX_RETRIES: pgboss schema creation failed, retrying in ${RETRY_DELAY}s..."
        sleep $RETRY_DELAY
    done
    log "pgboss schema created successfully"

    log "Granting necessary permissions..."
    PGPASSWORD="${PG_PASSWORD}" psql -h ${PG_ADMIN_HOST} -p ${PG_ADMIN_PORT} -U postgres -d ${DB_NAME_SERVER:-server} -c 'GRANT ALL ON SCHEMA public TO postgres;'

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
