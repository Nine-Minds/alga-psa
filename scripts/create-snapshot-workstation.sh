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

# Check if btrfs is available
if ! command -v btrfs &> /dev/null; then
  warn "btrfs command not found. Snapshots require btrfs filesystem support."
  warn "Proceeding without snapshot - will use direct mount instead."
  USE_SNAPSHOT=false
else
  USE_SNAPSHOT=true
fi

# Build timestamp and paths
TIMESTAMP=$(date +"%Y%m%d%H%M%S")
SRC_DIR=$(pwd)
SNAPSHOT_BASE="${HOME}/snapshots"
SNAPSHOT_TARGET="${SNAPSHOT_BASE}/alga-psa-snap-${TIMESTAMP}"

# Create snapshots directory if it doesn't exist
if [ "$USE_SNAPSHOT" = true ]; then
  mkdir -p "$SNAPSHOT_BASE"
  info "Snapshot base directory: $SNAPSHOT_BASE"
fi

# Create the snapshot
if [ "$USE_SNAPSHOT" = true ]; then
  info "Creating btrfs snapshot from $SRC_DIR to $SNAPSHOT_TARGET"
  
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

# Generate a random password for the dev workstation if not set
if [ -z "$DEV_WORKSTATION_PASSWORD" ]; then
  export DEV_WORKSTATION_PASSWORD="alga-dev-$(openssl rand -hex 4)"
  info "Generated random password for dev workstation: $DEV_WORKSTATION_PASSWORD"
fi

# Set the port for the code-server
DEV_WORKSTATION_PORT=${DEV_WORKSTATION_PORT:-8080}

# Run the code-server container
CONTAINER_NAME="code-server-${TIMESTAMP}"
info "Starting code-server container: $CONTAINER_NAME"

docker run -d \
  --name "$CONTAINER_NAME" \
  --rm \
  -p ${DEV_WORKSTATION_PORT}:8080 \
  -e "PASSWORD=$DEV_WORKSTATION_PASSWORD" \
  -v "${MOUNT_PATH}:/home/coder/project" \
  -v "code-server-extensions:/home/coder/.local/share/code-server/extensions" \
  $(docker build -q ./tools/dev-workstation/dev-container) \
  --auth password \
  --bind-addr 0.0.0.0:8080

# Get the container IP
HOST_IP=$(hostname -I | awk '{print $1}')

info "✅ Dev workstation started successfully"
info "🔌 VS Code is available at:"
info "    http://$HOST_IP:$DEV_WORKSTATION_PORT"
info "    Password: $DEV_WORKSTATION_PASSWORD"

if [ "$USE_SNAPSHOT" = true ]; then
  info "📸 Using btrfs snapshot at: $SNAPSHOT_TARGET"
  info "   This allows you to make changes without affecting the original code."
else
  info "📂 Using direct mount from: $MOUNT_PATH"
  info "   Any changes will directly affect the source code."
fi

info ""
info "To stop the workstation container:"
info "    docker stop $CONTAINER_NAME"