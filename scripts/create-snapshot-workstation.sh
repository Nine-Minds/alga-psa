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
# Generate a short random ID for this workstation
WORKSTATION_ID=$(openssl rand -hex 4)
SRC_DIR=$(pwd)
SNAPSHOT_BASE="${HOME}/snapshots"
SNAPSHOT_TARGET="${SNAPSHOT_BASE}/alga-psa-snap-${TIMESTAMP}"

# Workstation name - can be specified or auto-generated
WORKSTATION_NAME=${WORKSTATION_NAME:-"alga-ws-${WORKSTATION_ID}"}
info "Workstation name: $WORKSTATION_NAME"

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

# Run the code-server container with a randomly assigned port
CONTAINER_NAME="${WORKSTATION_NAME}"
info "Starting code-server container: $CONTAINER_NAME"

docker run -d \
  --name "$CONTAINER_NAME" \
  --rm \
  -p 8080 \
  -e "PASSWORD=$DEV_WORKSTATION_PASSWORD" \
  -v "${MOUNT_PATH}:/home/coder/project" \
  -v "code-server-extensions:/home/coder/.local/share/code-server/extensions" \
  $(docker build -q ./tools/dev-workstation/dev-container) \
  --auth password \
  --bind-addr 0.0.0.0:8080

# Get the container ID and port mapping
HOST_PORT=$(docker port $CONTAINER_NAME 8080 | cut -d':' -f2)
info "Random port assigned by Docker: $HOST_PORT"

# Try to get tailscale IP if available
if command -v tailscale &> /dev/null && tailscale status &> /dev/null; then
  HOST_IP=$(tailscale ip -4)
  info "Using Tailscale IP: $HOST_IP"
else
  # Fallback to regular IP
  HOST_IP=$(hostname -I | awk '{print $1}')
  info "Using local network IP: $HOST_IP"
fi

info "✅ Dev workstation started successfully"
info "🔌 VS Code is available at:"
info "    http://$HOST_IP:$HOST_PORT"
info "    Password: $DEV_WORKSTATION_PASSWORD"

if [ "$USE_SNAPSHOT" = true ]; then
  info "📸 Using btrfs snapshot at: $SNAPSHOT_TARGET"
  info "   This allows you to make changes without affecting the original code."
else
  info "📂 Using direct mount from: $MOUNT_PATH"
  info "   Any changes will directly affect the source code."
fi

info ""
info "Workstation details:"
info "  - Workstation name: $WORKSTATION_NAME"
info "  - Running on port: $HOST_PORT"
info ""
info "To stop the workstation container:"
info "    docker stop $CONTAINER_NAME"
info ""
info "This workstation is running alongside any other existing workstations"