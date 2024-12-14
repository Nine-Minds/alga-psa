#!/bin/bash
set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."
    until PGPASSWORD=$(cat /run/secrets/db_password_hocuspocus) psql -h postgres -U ${DB_USER:-postgres} -c '\q' 2>/dev/null; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    log "PostgreSQL is up and running!"
}

# Function to check if redis is ready
wait_for_redis() {
    log "Waiting for Redis to be ready..."
    until redis-cli -h ${REDIS_HOST:-redis} -p ${REDIS_PORT:-6379} -a $(cat /run/secrets/redis_password) ping 2>/dev/null; do
        log "Redis is unavailable - sleeping"
        sleep 1
    done
    log "Redis is up and running!"
}

# Main startup process
main() {
    wait_for_postgres
    wait_for_redis

    if [ "$NODE_ENV" = "development" ]; then
        log "Starting Hocuspocus in development mode..."
        npm run dev
    else
        log "Starting Hocuspocus in production mode..."
        npm start
    fi
}

# Execute main function
main
