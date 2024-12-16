#!/bin/bash
set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Function to print version banner
print_version_banner() {
    local version="${VERSION:-0.0.0}"
    local commit="${COMMIT:-unknown}"
    local date="$(date +'%Y-%m-%d')"
    local author="${AUTHOR:-NineMinds}"

    echo "
    ****************************************************
    *                                                  *
    *               ALGA PSA NEXT.JS                   *
    *                                                  *
    *               Version .: $version                *
    *               Commit  .: $commit                 *
    *               Date    .: $date                   *
    *               Author  .: $author                 *
    *                                                  *
    ****************************************************
    "
}

# Function to validate required environment variables
validate_environment() {
    log "Validating environment variables..."
    
    # Required variables
    local required_vars=(
        "DB_TYPE"
        "DB_USER_ADMIN"
        "LOG_LEVEL"
        "LOG_IS_FORMAT_JSON"
        "LOG_IS_FULL_DETAILS"
        "EMAIL_ENABLE"
        "EMAIL_FROM"
        "EMAIL_PORT"
        "EMAIL_USERNAME"
        "NEXTAUTH_URL"
        "NEXTAUTH_SESSION_EXPIRES"
    )

    local missing_vars=()
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done

    if [ "$DB_TYPE" != "postgres" ]; then
        log "Error: DB_TYPE must be 'postgres'"
        return 1
    fi

    # Validate LOG_LEVEL
    case "$LOG_LEVEL" in
        SYSTEM|TRACE|DEBUG|INFO|WARNING|ERROR|CRITICAL)
            ;;
        *)
            log "Error: Invalid LOG_LEVEL. Must be one of: SYSTEM, TRACE, DEBUG, INFO, WARNING, ERROR, CRITICAL"
            return 1
            ;;
    esac

    # Validate numeric values
    if ! [[ "$EMAIL_PORT" =~ ^[1-9][0-9]*$ ]]; then
        log "Error: EMAIL_PORT must be a number greater than 0"
        return 1
    fi
    if ! [[ "$NEXTAUTH_SESSION_EXPIRES" =~ ^[1-9][0-9]*$ ]]; then
        log "Error: NEXTAUTH_SESSION_EXPIRES must be a number greater than 0"
        return 1
    fi

    # Validate email format
    local email_regex="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    if ! [[ "$EMAIL_FROM" =~ $email_regex ]]; then
        log "Error: EMAIL_FROM must be a valid email address"
        return 1
    fi
    if ! [[ "$EMAIL_USERNAME" =~ $email_regex ]]; then
        log "Error: EMAIL_USERNAME must be a valid email address"
        return 1
    fi

    # Validate URL format
    if ! [[ "$NEXTAUTH_URL" =~ ^https?:// ]]; then
        log "Error: NEXTAUTH_URL must be a valid URL"
        return 1
    fi

    if [ ${#missing_vars[@]} -ne 0 ]; then
        log "Error: Missing required environment variables: ${missing_vars[*]}"
        return 1
    fi

    # Verify secret files exist
    if [ ! -f "/run/secrets/postgres_password" ]; then
        log "Error: postgres_password secret file not found"
        return 1
    fi
    if [ ! -f "/run/secrets/db_password_server" ]; then
        log "Error: db_password_server secret file not found"
        return 1
    fi

    log "Environment validation successful"
    return 0
}

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."
    # Use admin user for health check
    until PGPASSWORD=$(cat /run/secrets/postgres_password) psql -h postgres -U "$DB_USER_ADMIN" -c '\q' 2>/dev/null; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    log "PostgreSQL is up and running!"

    # Verify app_user can connect
    until PGPASSWORD=$(cat /run/secrets/db_password_server) psql -h postgres -U "$DB_USER_SERVER" -d server -c '\q' 2>/dev/null; do
        log "Waiting for app_user access..."
        sleep 1
    done
    log "Database access verified for app_user"
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

# Function to check if hocuspocus is ready
wait_for_hocuspocus() {
    # Skip if hocuspocus is not required
    if [ -z "${REQUIRE_HOCUSPOCUS}" ] || [ "${REQUIRE_HOCUSPOCUS}" = "false" ]; then
        log "Hocuspocus check skipped - not required for this environment"
        return 0
    fi

    log "Waiting for Hocuspocus to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "http://${HOCUSPOCUS_HOST:-hocuspocus}:${HOCUSPOCUS_PORT:-1234}/health" > /dev/null; then
            log "Hocuspocus is up and running!"
            return 0
        fi
        log "Hocuspocus is unavailable (attempt $attempt/$max_attempts) - sleeping"
        sleep 1
        attempt=$((attempt + 1))
    done

    if [ "${REQUIRE_HOCUSPOCUS}" = "true" ]; then
        log "Error: Hocuspocus failed to become ready after $max_attempts attempts"
        return 1
    else
        log "Warning: Hocuspocus is not available, but continuing anyway"
        return 0
    fi
}

# Function to start the application
start_app() {
    # Set up application database connection using app_user
    export DATABASE_URL="postgresql://$DB_USER_SERVER:$(cat /run/secrets/db_password_server)@postgres:5432/server"
    
    # Set NEXTAUTH_SECRET from Docker secret if not already set
    # if [ -z "$NEXTAUTH_SECRET" ]; then
    log "Setting NEXTAUTH_SECRET from secret file..."
    export NEXTAUTH_SECRET=$(cat /run/secrets/nextauth_secret)
    # fi
    
    if [ "$NODE_ENV" = "development" ]; then
        log "Starting server in development mode..."
        npm run dev
    else
        log "Starting server in production mode..."
        npm run build && npm start
    fi
}

# Main startup process
main() {
    print_version_banner
    
    # Validate environment
    if ! validate_environment; then
        log "Environment validation failed"
        exit 1
    fi
    
    # Wait for dependencies
    wait_for_postgres
    wait_for_redis
    wait_for_hocuspocus
    
    # Start the application
    start_app
}

# Execute main function with error handling
if ! main; then
    log "Error: Server failed to start properly"
    exit 1
fi
