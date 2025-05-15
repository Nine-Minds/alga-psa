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
# Generate a short random ID for this environment
ENVIRONMENT_ID=$(openssl rand -hex 4)
SRC_DIR=$(pwd)
SNAPSHOT_BASE="${HOME}/snapshots"
SNAPSHOT_TARGET="${SNAPSHOT_BASE}/alga-psa-snap-${TIMESTAMP}"

# Environment name - can be specified or auto-generated
ENVIRONMENT_NAME=${ENVIRONMENT_NAME:-"alga-env-${ENVIRONMENT_ID}"}
info "Environment name: $ENVIRONMENT_NAME"

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

# No longer need a password for the dev workstation
# Authentication disabled for convenience in secure environments

# Custom environment file for snapshot setup
section "Creating specialized environment file for snapshot setup"
SNAPSHOT_ENV_FILE="server/.env.snapshot-${TIMESTAMP}"
cp server/.env "$SNAPSHOT_ENV_FILE"

# Add snapshot specific settings to the environment file
cat >> "$SNAPSHOT_ENV_FILE" << EOF

# Snapshot-specific settings
SNAPSHOT_PATH=${MOUNT_PATH}
CONTAINER_WORKDIR=/home/coder/project
ENVIRONMENT_NAME=${ENVIRONMENT_NAME}
PGBOUNCER_HOST=${ENVIRONMENT_NAME}_pgbouncer
EXPOSE_PGBOUNCER_PORT=0  # Disable external port exposure for pgbouncer

# Unique port assignments for each service
EXPOSE_DB_PORT=$(( 5432 + RANDOM % 100 ))
EXPOSE_REDIS_PORT=$(( 6379 + RANDOM % 100 ))
EXPOSE_SERVER_PORT=$(( 3000 + RANDOM % 100 ))
EXPOSE_HOCUSPOCUS_PORT=$(( 1234 + RANDOM % 100 ))
EOF

info "Created environment file with snapshot settings: $SNAPSHOT_ENV_FILE"

# Create a custom docker-compose override file
section "Creating docker-compose override for snapshot"
OVERRIDE_FILE="docker-compose.snapshot-${TIMESTAMP}.yaml"

cat > "$OVERRIDE_FILE" << EOF

version: '3.8'

# Using docker compose -p instead of name: key for better isolation

services:
  dev-workstation:
    build:
      context: ./tools/dev-workstation/dev-container
      dockerfile: Dockerfile
    container_name: \${ENVIRONMENT_NAME}_dev-workstation
    environment:
      DISABLE_TELEMETRY: "true"
    ports:
      # Expose code-server on a random host port
      - "8080"
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
      "--auth", "none",
      "--port", "8080",
      "--bind-addr", "0.0.0.0:8080"
    ]
  
  # Override container names for all services to make them unique
  server:
    container_name: \${ENVIRONMENT_NAME}_server
    
  postgres:
    container_name: \${ENVIRONMENT_NAME}_postgres
    
  redis:
    container_name: \${ENVIRONMENT_NAME}_redis
    
  pgbouncer:
    container_name: \${ENVIRONMENT_NAME}_pgbouncer
    ports: []  # Override the ports from the base configuration to prevent external exposure
    
  hocuspocus:
    container_name: \${ENVIRONMENT_NAME}_hocuspocus
    
  setup:
    container_name: \${ENVIRONMENT_NAME}_setup

volumes:
  code-server-extensions:
    name: \${ENVIRONMENT_NAME}_extensions

networks:
  app-network:
    name: app-network
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

# Start the services with a project-specific name
info "Starting services with: docker compose -p $ENVIRONMENT_NAME $COMPOSE_FILES --env-file $SNAPSHOT_ENV_FILE up -d"
docker compose -p "$ENVIRONMENT_NAME" $COMPOSE_FILES --env-file "$SNAPSHOT_ENV_FILE" up -d

# Get the container ID and port mapping
DEV_CONTAINER_ID=$(docker ps --filter "name=${ENVIRONMENT_NAME}_dev-workstation" --format "{{.ID}}")

# Get host port - let Docker assign a random port
if [ -z "$DEV_WORKSTATION_PORT" ]; then
  HOST_PORT=$(docker port $DEV_CONTAINER_ID 8080 | cut -d':' -f2)
  info "Random port assigned by Docker: $HOST_PORT"
else
  HOST_PORT=$DEV_WORKSTATION_PORT
fi

# Try to get tailscale IP if available
if command -v tailscale &> /dev/null && tailscale status &> /dev/null; then
  HOST_IP=$(tailscale ip -4)
  info "Using Tailscale IP: $HOST_IP"
else
  # Fallback to regular IP
  HOST_IP=$(hostname -I | awk '{print $1}')
  info "Using local network IP: $HOST_IP"
fi

section "✅ Environment started successfully"

if [ "$USE_SNAPSHOT" = true ]; then
  info "📸 Using btrfs snapshot at: $SNAPSHOT_TARGET"
  info "   This allows you to make changes without affecting the original code."
else
  info "📂 Using direct mount from: $MOUNT_PATH"
  info "   Any changes will directly affect the source code."
fi

info "🔌 VS Code dev workstation is available at:"
info "    http://$HOST_IP:$HOST_PORT"
info "    No password required - authentication disabled for convenience"

info "🌐 Application server is available at:"
info "    http://$HOST_IP:${EXPOSE_SERVER_PORT:-3000}"

info ""
info "Environment configuration:"
info "  - Environment name: $ENVIRONMENT_NAME"
info "  - Docker Compose files: $COMPOSE_FILES"
info "  - Environment file: $SNAPSHOT_ENV_FILE"
info ""
info "To stop this environment:"
info "    docker compose -p $ENVIRONMENT_NAME down"
info ""
info "To view logs for this environment:"
info "    docker logs ${ENVIRONMENT_NAME}_server"
info "    docker logs ${ENVIRONMENT_NAME}_dev-workstation"
info ""
info "Environment $ENVIRONMENT_NAME is running alongside any other existing environments"