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

# Function to print version banner
print_version_banner() {
    # Prefer env provided by Helm; fall back to package.json in the container
    local pkg_version=""
    if [ -f "/app/server/package.json" ]; then
        pkg_version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p' /app/server/package.json | head -n1)
    fi

    version="${APP_VERSION:-${pkg_version:-unknown}}"
    commit="${APP_BUILD_SHA:-${GIT_SHA:-unknown}}"
    date="$(date +'%Y-%m-%d')"
    author="NineMinds"

    # Function to print colored text
    print_color() {
        color_code=$1
        message=$2
        echo -e "\033[${color_code}m${message}\033[0m"
    }

    # Print the first ASCII art (octopus)
    print_color "35" "
                               *******
                            ****************
                         ***********************
                      *****************************
                    *********************************
                   ************************************
                 ****************************************
                ******************************************
               *******************************************
               *********   ********************************
              ********     *********************************
              ********     *****  **************************
              ********   ******    *************************
             *****************     *************************
              ****************    **************************
              **********************************************
              **********************************************
              *********************************************
         ***  *******************************************
    *********  ******************************************
    *********   ****************************************
                ***************************************
                  ************************************  ***
           *****  ********************************** ******
         **********   *****************************    ******
       ************        ***********************         **
    ************      ***********   *************
    ***********          *************  ************ ***
    ******              ************   ************ *****
                       ***********     **********   ******
                      **********      **********     ******
                    **********       **********        *****
                  *********         *********            ****
                ********           ********                **
             ********            ********
             ***                *******
                              ******
                             ****
    "

    # Print the second ASCII art
    print_color "34" "
                 ###    ##       ######     ###          ######   #####     ### 
                ## ##   ##      ##    ##   ## ##         #     # #     #   ## ##
               ##   ##  ##      ##        ##   ##        #     # #        ##   ##
              ##     ## ##      ##  #### ##     ##       ######   #####  ##     ##
              ######### ##      ##    ## #########       #             # #########
              ##     ## ##      ##    ## ##     ##       #            #  ##     ##
              ##     ## ######## ######  ##     ##       #       ##### 	 ##     ##


    			  #####  ####### ######  #     # ####### ######  
    			 #     # #       #     # #     # #       #     # 
    			 #       #       #     # #     # #       #     # 
    			  #####  #####   ######  #     # #####   ######  
    			       # #       #   #    #   #  #       #   #   
    			 #     # #       #    #    # #   #       #    #  
    			  #####  ####### #     #    #    ####### #     # 
    "

    # Print the version information
    print_color "36" "
                        ****************************************************
                        *                                                  *
                        *               ALGA PSA NEXT.JS                   *
                        *                                                  *
                        *               Version .: $version               *
                        *               Commit  .: $commit                *
                        *               Date    .: $date                  *
                        *               Author  .: $author                *
                        *                                                  *
                        ****************************************************
    "

    # Reset color
    echo -e "\033[0m"

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
    # local email_regex="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    # if ! [[ "$EMAIL_FROM" =~ $email_regex ]]; then
    #     log "Error: EMAIL_FROM must be a valid email address"
    #     return 1
    # fi
    # if ! [[ "$EMAIL_USERNAME" =~ $email_regex ]]; then
    #     log "Error: EMAIL_USERNAME must be a valid email address"
    #     return 1
    # fi

    # Validate URL format
    if ! [[ "$NEXTAUTH_URL" =~ ^https?:// ]]; then
        log "Error: NEXTAUTH_URL must be a valid URL"
        return 1
    fi

    if [ ${#missing_vars[@]} -ne 0 ]; then
        log "Error: Missing required environment variables: ${missing_vars[*]}"
        return 1
    fi

    log "Environment validation successful"
    return 0
}

# Function to check if postgres is ready
wait_for_postgres() {
    log "Waiting for PostgreSQL to be ready.. (skipped)"
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
    local db_password_server=$(get_secret "db_password_server" "DB_PASSWORD_SERVER")
    export DATABASE_URL="postgresql://$DB_USER_SERVER:$db_password_server@postgres:5432/server"
    
    # Set NEXTAUTH_SECRET from Docker secret if not already set
    log "Setting NEXTAUTH_SECRET from secret file..."
    export NEXTAUTH_SECRET=$(get_secret "nextauth_secret" "NEXTAUTH_SECRET")
    
    # Debug: Check if .next directory exists
    log "DEBUG: Checking for build artifacts..."
    log "Current directory: $(pwd)"
    log "Contents of /app/server:"
    ls -la /app/server/ || true
    log "Checking for .next directory:"
    ls -la /app/server/.next/ || log ".next directory not found"
    log "Checking for dist directory:"
    ls -la /app/server/dist/ || log "dist directory not found"

    cd /app/server
    if [ "$NODE_ENV" = "development" ]; then
        log "Starting server in development mode..."
        if [ "${ENABLE_SSL:-false}" = "true" ]; then
            log "SSL is enabled - starting development HTTPS server..."
            npm run dev:https
        else
            npm run dev
        fi
    else
        log "Starting server in production mode..."

        # Try to start, but don't exit on failure - keep container running for debug
        local wait=false
        if [ "${ENABLE_SSL:-false}" = "true" ]; then
            log "SSL is enabled - starting HTTPS server in $(pwd)..."
            if ! npm run start:https; then
                wait=true
            fi
        else
            log "About to run npm start in directory: $(pwd)"
            if ! npm start; then
                wait=true
            fi
        fi

        if [ "$wait" = "true" ]; then
            log "ERROR: start failed, but keeping container alive for debugging"
            log "Sleeping indefinitely - you can exec into the container to troubleshoot"
            while true; do
                sleep 3600
            done
        fi
    fi
}

# Main startup process
main() {
    print_version_banner
    
    # Validate environment
    if ! validate_environment; then
        log "Environment validation failed"
        if [ "$NODE_ENV" = "development" ]; then
            exit 1
        fi
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
