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
        echo "${!env_var}"
    else
        echo "$default_value"
    fi
}

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready..."
    local db_password_server=$(get_secret "db_password_server" "DB_PASSWORD_SERVER")
    local readiness_user=${DB_USER_ADMIN:-${DB_USER_SERVER:-postgres}}
    until pg_isready -h ${DB_HOST:-postgres} -p ${DB_PORT:-5432} -U "$readiness_user" 2>/dev/null; do
        log "PostgreSQL is unavailable - sleeping"
        sleep 1
    done
    log "PostgreSQL is up and running!"
}

# Function to check if redis is ready
wait_for_redis() {
    log "Waiting for Redis to be ready..."
    local redis_password=$(get_secret "redis_password" "REDIS_PASSWORD")
    if [ -n "$redis_password" ]; then
        until redis-cli -h ${REDIS_HOST:-redis} -p ${REDIS_PORT:-6379} -a "$redis_password" ping 2>/dev/null; do
            log "Redis is unavailable - sleeping"
            sleep 1
        done
    else
        until redis-cli -h ${REDIS_HOST:-redis} -p ${REDIS_PORT:-6379} ping 2>/dev/null; do
            log "Redis is unavailable - sleeping"
            sleep 1
        done
    fi
    log "Redis is up and running!"
}

# Function to check if the Temporal frontend is accepting connections.
# The v2 workflow runtime connects to Temporal as its first action and does NOT
# retry: if the frontend isn't up yet (a common startup-ordering race), the
# worker process exits. Wait for it here, like postgres/redis, so the race never
# crashes the worker. Set WAIT_FOR_TEMPORAL=false to skip (non-Temporal setups).
wait_for_temporal() {
    if [ "${WAIT_FOR_TEMPORAL:-true}" != "true" ]; then
        log "Skipping Temporal readiness wait (WAIT_FOR_TEMPORAL=${WAIT_FOR_TEMPORAL})"
        return 0
    fi
    local address="${TEMPORAL_ADDRESS:-temporal-frontend.temporal.svc.cluster.local:7233}"
    local host="${address%%:*}"
    local port="${address##*:}"
    # Fall back to the default port if TEMPORAL_ADDRESS carried no ":port".
    [ "$port" = "$host" ] && port=7233
    log "Waiting for Temporal frontend at ${host}:${port} to be ready..."
    # bash /dev/tcp avoids needing a temporal CLI or nc in the image.
    until (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; do
        log "Temporal is unavailable - sleeping"
        sleep 1
    done
    log "Temporal is up and running!"
}

# Function to start the workflow worker
start_workflow_worker() {
    # Set up application database connection using app_user
    local db_password_server=$(get_secret "db_password_server" "DB_PASSWORD_SERVER")
    export DATABASE_URL="postgresql://$DB_USER_SERVER:$db_password_server@${DB_HOST:-postgres}:${DB_PORT:-5432}/${DB_NAME_SERVER:-server}"
    
    # Set NEXTAUTH_SECRET from Docker secret if not already set
    log "Setting NEXTAUTH_SECRET from secret file..."
    export NEXTAUTH_SECRET=$(get_secret "nextauth_secret" "NEXTAUTH_SECRET")
    
    log "Starting workflow worker..."
    
    # Start the workflow worker process
    log "DEV_MODE is set to: '$DEV_MODE'"
    if [ "$DEV_MODE" = "true" ]; then
        log "Starting workflow worker in DEVELOPMENT mode with hot reload..."
        cd /app/services/workflow-worker && npm run dev
    else
        log "Starting workflow worker in PRODUCTION mode..."
        cd /app/services/workflow-worker && npm run start
    fi
}

# Main startup process
main() {
    log "Initializing workflow worker..."
    
    # Wait for dependencies
    wait_for_postgres
    wait_for_redis
    wait_for_temporal

    # Start the workflow worker
    start_workflow_worker
}

# Execute main function with error handling
if ! main; then
    log "Error: Workflow worker failed to start properly"
    # Exit non-zero so Kubernetes restarts the container (and the liveness probe
    # catches a worker that wedged after start). Hanging here instead would mask
    # the failure: with no process to fail a probe, k8s reports the pod healthy
    # forever. Set DEBUG_HANG_ON_FAILURE=true to keep the container up for
    # interactive debugging instead.
    if [ "${DEBUG_HANG_ON_FAILURE:-false}" = "true" ]; then
        log "DEBUG_HANG_ON_FAILURE=true - sleeping to keep the container running for debugging"
        while true; do
            sleep 3600  # Sleep for 1 hour
        done
    fi
    exit 1
fi
