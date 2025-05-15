#!/bin/bash
set -e

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print a message with a colored prefix
info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check if .env file exists, create from example if it doesn't
if [ ! -f server/.env ]; then
  info "Creating server/.env from .env.example"
  cp .env.example server/.env
  warn "Created server/.env - please review and update the configuration"
fi

# Create secrets directory if it doesn't exist
if [ ! -d secrets ]; then
  info "Creating secrets directory"
  mkdir -p secrets
fi

# Check for required secret files and create defaults if they don't exist
SECRETS=(
  "postgres_password"
  "db_password_server"
  "db_password_hocuspocus"
  "redis_password"
  "email_password"
  "crypto_key"
  "token_secret_key"
  "nextauth_secret"
  "google_oauth_client_id"
  "google_oauth_client_secret"
  "alga_auth_key"
)

for SECRET in "${SECRETS[@]}"; do
  if [ ! -f "secrets/$SECRET" ]; then
    if [ "$SECRET" == "google_oauth_client_id" ] || [ "$SECRET" == "google_oauth_client_secret" ]; then
      echo "" > "secrets/$SECRET"
    elif [ "$SECRET" == "postgres_password" ] || [ "$SECRET" == "db_password_server" ] || [ "$SECRET" == "db_password_hocuspocus" ] || [ "$SECRET" == "redis_password" ] || [ "$SECRET" == "email_password" ]; then
      echo "dev-password-$(openssl rand -hex 8)" > "secrets/$SECRET"
    else
      echo "$(openssl rand -hex 16)" > "secrets/$SECRET"
    fi
    info "Created default secret: $SECRET"
  fi
done

# Set proper permissions on secrets
chmod 600 secrets/*
info "Set permissions on secret files"

# Generate a random password for the dev workstation if not set
if [ -z "$DEV_WORKSTATION_PASSWORD" ]; then
  export DEV_WORKSTATION_PASSWORD="alga-dev-$(openssl rand -hex 4)"
  info "Generated random password for dev workstation: $DEV_WORKSTATION_PASSWORD"
fi

# Determine which compose files to use
COMPOSE_FILES="-f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml -f docker-compose.dev-workstation.yaml"

# Check if we need to include EE components
if [ "$EDITION" == "enterprise" ]; then
  COMPOSE_FILES="-f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml -f docker-compose.ee.yaml -f docker-compose.dev-workstation.yaml"
  info "Including Enterprise Edition components"
fi

# Start the services
info "Starting services with: docker compose $COMPOSE_FILES --env-file server/.env up -d"
docker compose $COMPOSE_FILES --env-file server/.env up -d

# Get the container ID and IP
CONTAINER_ID=$(docker ps --filter "name=${APP_NAME:-sebastian}_dev-workstation" --format "{{.ID}}")
HOST_IP=$(hostname -I | awk '{print $1}')
PORT=$(docker port $CONTAINER_ID 8080 | cut -d':' -f2)

info "✅ Environment started successfully"
info "🔌 VS Code dev workstation is available at:"
info "    http://$HOST_IP:$PORT"
info "    Password: $DEV_WORKSTATION_PASSWORD"
info "🌐 Application server is available at:"
info "    http://$HOST_IP:${EXPOSE_SERVER_PORT:-3000}"