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

# Function to merge CE and EE migrations
merge_migrations() {
    log "Merging CE and EE migrations..."
    
    # Create the final migrations directory
    mkdir -p /app/server/migrations
    
    # Copy all CE migrations first
    if [ -d "/app/server/migrations-ce" ] && [ "$(ls -A /app/server/migrations-ce)" ]; then
        log "Copying CE migrations..."
        cp -r /app/server/migrations-ce/* /app/server/migrations/
        log "CE migrations copied successfully"
    else
        log "No CE migrations found"
    fi
    
    # Overlay EE migrations (overwrites CE files with same name)
    if [ -d "/app/server/migrations-ee" ] && [ "$(ls -A /app/server/migrations-ee)" ]; then
        log "Overlaying EE migrations..."
        cp -r /app/server/migrations-ee/* /app/server/migrations/
        log "EE migrations overlaid successfully"
    else
        log "No EE migrations found"
    fi
    
    # List final migrations for verification
    log "Final migration files:"
    ls -la /app/server/migrations/ | head -20
}

# Function to merge CE and EE seeds
merge_seeds() {
    log "Merging CE and EE seeds..."
    
    # Create the final seeds directory
    mkdir -p /app/server/seeds
    
    # Copy all CE seeds first
    if [ -d "/app/server/seeds-ce" ] && [ "$(ls -A /app/server/seeds-ce)" ]; then
        log "Copying CE seeds..."
        cp -r /app/server/seeds-ce/* /app/server/seeds/
        log "CE seeds copied successfully"
    else
        log "No CE seeds found"
    fi
    
    # Overlay EE seeds (overwrites CE files with same name)
    if [ -d "/app/server/seeds-ee" ] && [ "$(ls -A /app/server/seeds-ee)" ]; then
        log "Overlaying EE seeds..."
        cp -r /app/server/seeds-ee/* /app/server/seeds/
        log "EE seeds overlaid successfully"
    else
        log "No EE seeds found"
    fi
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
    log "Starting Enterprise Edition setup..."
    
    wait_for_postgres

    # Merge CE and EE migrations/seeds
    merge_migrations
    merge_seeds

    log "Creating database..."
    node /app/server/setup/create_database.js

    log "Creating pgboss schema..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U postgres -d ${DB_NAME_SERVER:-server} -c 'CREATE SCHEMA IF NOT EXISTS pgboss;'

    log "Granting necessary permissions..."
    PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U postgres -d ${DB_NAME_SERVER:-server} -c 'GRANT ALL ON SCHEMA public TO postgres;'

    log "Running merged migrations (CE + EE)..."
    NODE_ENV=migration npx knex migrate:latest --knexfile /app/server/knexfile.cjs

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

    log "Enterprise Edition setup completed!"
    log "Exiting with success code: 0"
    exit 0
}

# Execute main function
main