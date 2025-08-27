#!/bin/bash

# Check if a Docker Compose file is provided
if [ $# -lt 1 ]; then
    echo "Please provide a Docker Compose file as an argument."
    echo "Usage: $0 <docker-compose-file> [additional-args]"
    exit 1
fi

COMPOSE_FILE=$1
shift
ADDITIONAL_ARGS=$@

# Default network settings
NETWORK_NAME=app-network
USE_EXTERNAL_NETWORK=true

# Parse additional arguments
DOCKER_COMPOSE_ARGS=""
COMMAND="up"
for arg in $ADDITIONAL_ARGS; do
    case $arg in
        --no-network)
            NETWORK_NAME=default
            USE_EXTERNAL_NETWORK=false
            ;;
        -d)
            DOCKER_COMPOSE_ARGS+=" -d"
            ;;
        --watch)
            COMMAND="watch"
            ;;
        *)
            DOCKER_COMPOSE_ARGS+=" $arg"
            ;;
    esac
done

# Function to clean up
cleanup() {
    echo "Cleaning up..."
    rm -f /tmp/.env
    #rm ./setup/setup.sql
}

# Set up trap to call cleanup function
trap cleanup EXIT

# Check if prod.config.ini exists, if not, copy config.ini to prod.config.ini
if [ ! -f "prod.config.ini" ]; then
    cp config.ini prod.config.ini
fi

# Generate .env file from config.ini
echo "# Generated from prod.config.ini" > /tmp/.env
while IFS='=' read -r key value
do
    if [[ $key == \[*] ]]; then
        continue
    elif [[ $value ]]; then
        echo "${key}=${value}" >> /tmp/.env
    fi
done < prod.config.ini

#Initial setup
#./setup/setup.sh

# Validate secrets before running Docker Compose
validate_secrets() {
    local SECRETS_DIR="./secrets"
    local ERRORS=0
    
    echo "Validating secret files..."
    
    # Check if secrets directory exists
    if [ ! -d "$SECRETS_DIR" ]; then
        echo "Warning: Secrets directory not found at $SECRETS_DIR - skipping validation"
        return 0
    fi
    
    # List of required secret files for docker-compose
    local REQUIRED_SECRETS=(
        "postgres_password"
        "db_password_server"
    )
    
    for secret in "${REQUIRED_SECRETS[@]}"; do
        local file="$SECRETS_DIR/$secret"
        
        # Check if file exists
        if [ ! -f "$file" ]; then
            echo "❌ Missing required secret: $file"
            ERRORS=$((ERRORS + 1))
            continue
        fi
        
        # Check if file is empty
        if [ ! -s "$file" ]; then
            echo "❌ Empty secret file: $file"
            ERRORS=$((ERRORS + 1))
            continue
        fi
        
        # Fix files missing trailing newlines (common issue)
        if [ "$(tail -c 1 "$file" | wc -l)" -eq 0 ]; then
            echo "⚠️  Fixing missing newline in: $file"
            echo "" >> "$file"
        fi
    done
    
    if [ $ERRORS -gt 0 ]; then
        echo "❌ Secret validation failed with $ERRORS errors"
        echo "Please ensure all required secrets are present in ./secrets/"
        exit 1
    else
        echo "✅ Secrets validated successfully"
    fi
}

# Run validation
validate_secrets

# Add network configuration to .env
echo "NETWORK_NAME=${NETWORK_NAME}" >> /tmp/.env
echo "USE_EXTERNAL_NETWORK=${USE_EXTERNAL_NETWORK}" >> /tmp/.env
#echo "APP_ENV=${APP_ENV}" >> /tmp/.env

# Run docker-compose
if [ -f "$COMPOSE_FILE" ]; then
    echo "Running Docker Compose for $COMPOSE_FILE with command: $COMMAND"
    docker compose -f "$COMPOSE_FILE" --env-file /tmp/.env $COMMAND $DOCKER_COMPOSE_ARGS
else
    echo "Docker Compose file $COMPOSE_FILE not found"
    exit 1
fi