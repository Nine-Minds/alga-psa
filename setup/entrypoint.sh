#!/bin/bash
set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."
    until PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -c '\q' 2>/dev/null; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    log "PostgreSQL is up and running!"
}

# Main setup process
main() {
    wait_for_postgres

    log "Creating database..."
    node /app/server/setup/create_database.js

    log "Creating pgboss schema..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -d server -c 'CREATE SCHEMA IF NOT EXISTS pgboss;'

    log "Running migrations..."
    NODE_ENV=migration npx knex migrate:latest --knexfile /app/server/knexfile.cjs

    log "Running seeds..."
    NODE_ENV=migration npx knex seed:run --knexfile /app/server/knexfile.cjs

    log "Setup completed successfully!"
}

# Execute main function
main
