#!/bin/bash
set -e

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print a message with a colored prefix
info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

section() {
  echo -e "${BLUE}[SECTION]${NC} $1"
}

# Check if btrfs is available
section "Checking filesystem support for snapshots"
if ! command -v btrfs &> /dev/null; then
  warn "btrfs command not found. Snapshots require btrfs filesystem support."
  warn "Proceeding without snapshot - will use direct mount instead."
  USE_SNAPSHOT=false
else
  USE_SNAPSHOT=true
  info "btrfs detected, snapshot support available"
fi

# Build timestamp and paths
TIMESTAMP=$(date +"%Y%m%d%H%M%S")
SRC_DIR=$(pwd)
SNAPSHOT_BASE="${HOME}/snapshots"
SNAPSHOT_TARGET="${SNAPSHOT_BASE}/alga-psa-snap-${TIMESTAMP}"

# Create snapshots directory if it doesn't exist and we're using snapshots
if [ "$USE_SNAPSHOT" = true ]; then
  mkdir -p "$SNAPSHOT_BASE"
  info "Snapshot base directory: $SNAPSHOT_BASE"
fi

# Create the snapshot if we're using btrfs
if [ "$USE_SNAPSHOT" = true ]; then
  section "Creating btrfs snapshot"
  info "Source: $SRC_DIR"
  info "Target: $SNAPSHOT_TARGET"
  
  # Attempt to create a btrfs snapshot
  if btrfs subvolume snapshot "$SRC_DIR" "$SNAPSHOT_TARGET" 2>/dev/null; then
    info "✅ Snapshot created successfully at: $SNAPSHOT_TARGET"
    MOUNT_PATH="$SNAPSHOT_TARGET"
  else
    warn "Failed to create btrfs snapshot. Your filesystem may not be btrfs."
    warn "Falling back to direct mount."
    USE_SNAPSHOT=false
  fi
fi

# Use direct mount if snapshot failed or isn't available
if [ "$USE_SNAPSHOT" = false ]; then
  MOUNT_PATH="$SRC_DIR"
  info "Using direct mount from: $MOUNT_PATH"
fi

# Check if .env file exists, create from example if it doesn't
section "Setting up environment configuration"
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

# Custom environment file for snapshot setup
section "Creating specialized environment file for snapshot setup"
SNAPSHOT_ENV_FILE="server/.env.snapshot-${TIMESTAMP}"
cp server/.env "$SNAPSHOT_ENV_FILE"

# Add snapshot specific settings to the environment file
cat >> "$SNAPSHOT_ENV_FILE" << EOF

# Snapshot-specific settings
SNAPSHOT_PATH=${MOUNT_PATH}
DEV_WORKSTATION_PASSWORD=${DEV_WORKSTATION_PASSWORD}
CONTAINER_WORKDIR=/home/coder/project
EOF

info "Created environment file with snapshot settings: $SNAPSHOT_ENV_FILE"

# Create a custom docker-compose override file
section "Creating docker-compose override for snapshot"
OVERRIDE_FILE="docker-compose.snapshot-${TIMESTAMP}.yaml"

cat > "$OVERRIDE_FILE" << EOF
version: '3.8'

services:
  dev-workstation:
    build:
      context: ./tools/dev-workstation/dev-container
      dockerfile: Dockerfile
    container_name: ${APP_NAME:-sebastian}_dev-workstation
    environment:
      PASSWORD: \${DEV_WORKSTATION_PASSWORD}
      DISABLE_TELEMETRY: "true"
    ports:
      - "\${DEV_WORKSTATION_PORT:-8080}:8080"
    volumes:
      # Mount the snapshot or direct path
      - type: bind
        source: \${SNAPSHOT_PATH}
        target: \${CONTAINER_WORKDIR}
      # Configure persistent extensions directory
      - type: volume
        source: code-server-extensions
        target: /home/coder/.local/share/code-server/extensions
    networks:
      - app-network
    depends_on:
      server:
        condition: service_started
      postgres:
        condition: service_started
    command: [
      "--auth", "password",
      "--port", "8080",
      "--bind-addr", "0.0.0.0:8080"
    ]

volumes:
  code-server-extensions:
    name: \${APP_NAME:-sebastian}_code-server-extensions
EOF

info "Created docker-compose override file: $OVERRIDE_FILE"

# Determine which compose files to use
section "Starting services with snapshot support"
COMPOSE_FILES="-f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml -f $OVERRIDE_FILE"

# Check if we need to include EE components
if [ "$EDITION" == "enterprise" ]; then
  COMPOSE_FILES="-f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml -f docker-compose.ee.yaml -f $OVERRIDE_FILE"
  info "Including Enterprise Edition components"
fi

# Start the services
info "Starting services with: docker compose $COMPOSE_FILES --env-file $SNAPSHOT_ENV_FILE up -d"
docker compose $COMPOSE_FILES --env-file "$SNAPSHOT_ENV_FILE" up -d

# Get the container ID and IP
HOST_IP=$(hostname -I | awk '{print $1}')
DEV_WORKSTATION_PORT=${DEV_WORKSTATION_PORT:-8080}

section "✅ Environment started successfully"

if [ "$USE_SNAPSHOT" = true ]; then
  info "📸 Using btrfs snapshot at: $SNAPSHOT_TARGET"
  info "   This allows you to make changes without affecting the original code."
else
  info "📂 Using direct mount from: $MOUNT_PATH"
  info "   Any changes will directly affect the source code."
fi

info "🔌 VS Code dev workstation is available at:"
info "    http://$HOST_IP:$DEV_WORKSTATION_PORT"
info "    Password: $DEV_WORKSTATION_PASSWORD"

info "🌐 Application server is available at:"
info "    http://$HOST_IP:${EXPOSE_SERVER_PORT:-3000}"

info ""
info "Environment configuration:"
info "  - Docker Compose files: $COMPOSE_FILES"
info "  - Environment file: $SNAPSHOT_ENV_FILE"
info ""
info "To stop this environment:"
info "    docker compose $COMPOSE_FILES --env-file $SNAPSHOT_ENV_FILE down"