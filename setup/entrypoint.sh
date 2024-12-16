#!/bin/bash

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to handle errors
handle_error() {
    local exit_code=$?
    log "An error occurred (Exit code: $exit_code)"
    log "Container will continue running despite the error"
    # Don't exit, just return from the function
    return $exit_code
}

# Set up error handling
trap 'handle_error' ERR

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."
    until PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -c '\q' 2>/dev/null; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    log "PostgreSQL is up and running!"
}

# Function to check if seeds have been run
check_seeds_status() {
    local has_seeds
    has_seeds=$(PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -d server -tAc "SELECT EXISTS (SELECT 1 FROM users LIMIT 1);")
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
    node /app/server/setup/create_database.js || true

    log "Creating pgboss schema..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -d server -c 'CREATE SCHEMA IF NOT EXISTS pgboss;' || true

    log "Granting necessary permissions..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -d server -c 'GRANT ALL ON SCHEMA public TO postgres;' || true

    log "Running migrations..."
    NODE_ENV=migration npx knex migrate:latest --knexfile /app/server/knexfile.cjs || true

    # Check if seeds need to be run
    if ! check_seeds_status; then
        log "Running seeds..."
        NODE_ENV=migration npx knex seed:run --knexfile /app/server/knexfile.cjs || true
        log "Seeds completed!"
    else
        log "Seeds have already been run, skipping..."
    fi

    log "Setup completed!"
    
    # Keep the container running indefinitely
    log "Container will continue running..."
    while true; do
        sleep 3600  # Sleep for an hour
    done
}

# Execute main function
main
