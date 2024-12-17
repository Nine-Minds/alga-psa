#!/bin/bash
set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to get secret value from either Docker secret file or environment variable
get_secret() {
    local secret_name=$1
    local env_var=$2
    local default_value=${3:-""}
    local secret_path="/run/secrets/$secret_name"
    
    if [ -f "$secret_path" ]; then
        cat "$secret_path"
    elif [ ! -z "${!env_var}" ]; then
        log "Using $env_var environment variable instead of Docker secret"
        echo "${!env_var}"
    else
        log "Neither secret file $secret_path nor $env_var environment variable found, using default value"
        echo "$default_value"
    fi
}

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."
    local db_password=$(get_secret "db_password_hocuspocus" "DB_PASSWORD_HOCUSPOCUS")
    until PGPASSWORD="$db_password" psql -h postgres -U ${DB_USER:-postgres} -c '\q' 2>/dev/null; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    log "PostgreSQL is up and running!"
}

# Function to check if redis is ready
wait_for_redis() {
    log "Waiting for Redis to be ready..."
    local redis_password=$(get_secret "redis_password" "REDIS_PASSWORD")
    until redis-cli -h ${REDIS_HOST:-redis} -p ${REDIS_PORT:-6379} -a "$redis_password" ping 2>/dev/null; do
        log "Redis is unavailable - sleeping"
        sleep 1
    done
    log "Redis is up and running!"
}

# Main startup process
main() {
    # Set Redis password from secret for the Node.js application
    export REDIS_PASSWORD=$(get_secret "redis_password" "REDIS_PASSWORD")
    
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
