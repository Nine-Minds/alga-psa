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

# Main setup process
main() {
    wait_for_postgres

    log "Installing pg-boss..."
    npm install pg-boss || true

    log "Creating database..."
    node /app/server/setup/create_database.js || true

    log "Creating pgboss schema..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -d server -c 'CREATE SCHEMA IF NOT EXISTS pgboss;' || true

    log "Granting necessary permissions..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U postgres -d server -c 'GRANT ALL ON SCHEMA public TO postgres;' || true

    log "Running combined CE and EE migrations..."
    node /app/ee/server/run-migrations.cjs || true

    log "Running combined CE and EE seeds..."
    node /app/ee/server/run-seeds.cjs || true

    log "Setup completed!"
    
    # Keep the container running indefinitely
    log "Container will continue running..."
    while true; do
        sleep 3600  # Sleep for an hour
    done
}

# Execute main function
main
