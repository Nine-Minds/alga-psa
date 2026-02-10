#!/bin/bash
set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >&2
}

# Function to get secret value from either Docker secret file or environment variable
get_secret() {
    local secret_name=$1
    local env_var=$2
    local default_value=${3:-""}
    local secret_path="/run/secrets/$secret_name"
    local secret_value=""
    
    if [ -f "$secret_path" ]; then
        secret_value=$(cat "$secret_path" | tr -d '[:space:]')
        if [ ! -z "$secret_value" ]; then
            echo "$secret_value"
            return
        fi
        log "Warning: Empty secret file $secret_path"
    fi
    
    if [ ! -z "${!env_var}" ]; then
        secret_value="${!env_var}"
        if [ ! -z "$secret_value" ]; then
            log "Using $env_var environment variable instead of Docker secret"
            echo "$secret_value"
            return
        fi
        log "Warning: Empty environment variable $env_var"
    fi

    if [ -z "$default_value" ]; then
        log "Error: No valid secret found and no default value provided for $secret_name"
        echo ""
    else
        log "Using default value for $secret_name"
        echo "$default_value"
    fi
}

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."

    # Try to get hocuspocus password first
    local db_password=$(get_secret "db_password_hocuspocus" "DB_PASSWORD_HOCUSPOCUS")

    # If not found, try postgres password as fallback
    if [ -z "$db_password" ]; then
        log "DB_PASSWORD_HOCUSPOCUS not found, trying POSTGRES_PASSWORD as fallback"
        db_password=$(get_secret "postgres_password" "POSTGRES_PASSWORD")
        if [ -z "$db_password" ]; then
            log "Error: No database password available (tried DB_PASSWORD_HOCUSPOCUS and POSTGRES_PASSWORD)"
            exit 1
        fi
    fi
    local db_user=$(get_secret "db_user_hocuspocus" "DB_USER_HOCUSPOCUS" "hocuspocus_user")
    local db_name=$(get_secret "db_name_hocuspocus" "DB_NAME_HOCUSPOCUS" "hocuspocus")

    # Store credentials before logging
    export PGPASSWORD="$db_password"
    export DB_PASSWORD_HOCUSPOCUS="$db_password"
    export DB_USER_HOCUSPOCUS="$db_user"
    export DB_NAME_HOCUSPOCUS="$db_name"

    # Get DB host from environment or default
    local db_host=${DB_HOST:-postgres}
    local db_port=${DB_PORT:-5432}

    # Debug logging after storing credentials
    log "Using database host: $db_host"
    log "Using database port: $db_port"
    log "Using database user: $db_user"
    log "Using database name: $db_name"
    log "Using database password: ${db_password:0:3}..." # Only show first 3 chars for security

    until psql -h "$db_host" -p "$db_port" -U "$db_user" -d "$db_name" -c '\q' 2>&1; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    log "PostgreSQL is up and running!"
}

# Function to check if redis is ready
wait_for_redis() {
    log "Waiting for Redis to be ready..."
    local redis_password=$(get_secret "redis_password" "REDIS_PASSWORD")
    
    # Store credentials before logging
    local redis_host=${REDIS_HOST:-redis}
    local redis_port=${REDIS_PORT:-6379}
    
    # Debug logging after storing credentials
    log "Using Redis host: $redis_host"
    log "Using Redis port: $redis_port"
    
    until redis-cli -h "$redis_host" -p "$redis_port" -a "$redis_password" ping 2>/dev/null; do
        log "Redis is unavailable - sleeping"
        sleep 1
    done
    log "Redis is up and running!"
}

# Main startup process
main() {
    # Get and store Redis password before any logging
    local redis_password=$(get_secret "redis_password" "REDIS_PASSWORD")
    export REDIS_PASSWORD="$redis_password"
    
    log "Starting services check..."
    wait_for_postgres
    wait_for_redis

    log "Starting Hocuspocus..."
    npm start
}

# Execute main function
main
