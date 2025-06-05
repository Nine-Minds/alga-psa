#!/bin/bash

# Improved VNC startup script for Kubernetes environments
# This version includes better error handling and fallback options

echo "=== Improved VNC Startup Script for Kubernetes ==="
echo "Starting at: $(date)"
echo "Running as: $(id)"

# Configuration
DISPLAY_NUM=99
export DISPLAY=:${DISPLAY_NUM}
VNC_PORT=5901
WEBSOCKET_PORT=5900
MAX_RETRIES=3
RETRY_DELAY=5

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_process() {
    local process_name=$1
    if pgrep -f "$process_name" > /dev/null; then
        local pid=$(pgrep -f "$process_name" | head -1)
        log_info "$process_name is running (PID: $pid)"
        return 0
    else
        log_error "$process_name is NOT running"
        return 1
    fi
}

setup_directories() {
    log_info "Setting up directories..."
    
    # Create necessary directories
    mkdir -p /tmp/.X11-unix /tmp/.ICE-unix /tmp/xvfb
    chmod 1777 /tmp/.X11-unix /tmp/.ICE-unix
    chmod 777 /tmp/xvfb
    
    # Set up user-specific directories if running as non-root
    if [ "$UID" != "0" ]; then
        export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp/xvfb/runtime-$UID}
        export XAUTHORITY=${XAUTHORITY:-/tmp/xvfb/.Xauthority-$UID}
        mkdir -p "$XDG_RUNTIME_DIR"
        chmod 700 "$XDG_RUNTIME_DIR"
    fi
}

check_system_resources() {
    log_info "Checking system resources..."
    
    # Memory check
    local mem_available=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    log_info "Available memory: ${mem_available}MB"
    
    if [ "$mem_available" -lt 256 ]; then
        log_warn "Low memory detected. Using minimal configuration."
        echo "minimal"
    elif [ "$mem_available" -lt 512 ]; then
        log_warn "Limited memory. Using reduced configuration."
        echo "reduced"
    else
        echo "standard"
    fi
}

start_xvfb() {
    local config_level=$(check_system_resources)
    local xvfb_started=false
    
    # Force software rendering to avoid DRI driver crashes in Kubernetes
    export LIBGL_ALWAYS_SOFTWARE=1
    export GALLIUM_DRIVER=llvmpipe
    export LP_NO_RAST=false
    export LIBGL_DRI3_DISABLE=1
    export LIBGL_ALWAYS_INDIRECT=1
    log_info "Forced software rendering mode for compatibility"
    
    # Kill any existing Xvfb processes
    pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
    sleep 2
    
    # Define configurations based on resource availability
    case "$config_level" in
        "minimal")
            local configs=(
                "-screen 0 640x480x8 -ac -extension GLX"
                "-screen 0 640x480x8 -ac"
                "-screen 0 320x240x8 -ac"
            )
            ;;
        "reduced")
            local configs=(
                "-screen 0 1920x1024x16 -ac -nolisten tcp -extension GLX"
                "-screen 0 1280x1024x16 -ac -extension GLX"
                "-screen 0 1024x768x16 -ac -extension GLX"
                "-screen 0 800x600x8 -ac"
            )
            ;;
        *)
            local configs=(
                "-screen 0 1920x1024x16 -ac -nolisten tcp -extension GLX +extension RANDR"
                "-screen 0 1280x1024x16 -ac -extension GLX"
                "-screen 0 1024x768x16 -ac -extension GLX"
                "-screen 0 800x600x16 -ac"
                "-screen 0 640x480x8 -ac"
            )
            ;;
    esac
    
    # Try each configuration
    for config in "${configs[@]}"; do
        log_info "Trying Xvfb configuration: $config"
        
        Xvfb :${DISPLAY_NUM} $config > /tmp/xvfb/xvfb.log 2>&1 &
        local xvfb_pid=$!
        sleep 3
        
        if kill -0 $xvfb_pid 2>/dev/null; then
            # Test if display is working
            if DISPLAY=:${DISPLAY_NUM} xdpyinfo > /tmp/xvfb/xdpyinfo.log 2>&1; then
                log_info "Xvfb started successfully with configuration: $config"
                xvfb_started=true
                break
            else
                log_warn "Display test failed, trying next configuration..."
                kill $xvfb_pid 2>/dev/null || true
            fi
        else
            log_warn "Xvfb failed to start with this configuration"
        fi
    done
    
    if [ "$xvfb_started" = "false" ]; then
        log_error "Failed to start Xvfb with any configuration"
        log_error "Last error log:"
        tail -20 /tmp/xvfb/xvfb.log
        return 1
    fi
    
    return 0
}

start_window_manager() {
    log_info "Starting window manager..."
    
    # Try fluxbox first, then fallback to simpler options
    if command -v fluxbox >/dev/null 2>&1; then
        # Create a simple fluxbox menu if it doesn't exist
        mkdir -p ~/.fluxbox
        if [ ! -f ~/.fluxbox/menu ]; then
            cat > ~/.fluxbox/menu << 'EOF'
[begin] (Fluxbox)
[exec] (Terminal) {x-terminal-emulator}
[exec] (File Manager) {thunar}
[submenu] (Applications)
    [exec] (Web Browser) {chromium}
    [exec] (Text Editor) {nano}
[end]
[submenu] (System)
    [exec] (Reload Config) {fluxbox-remote reload}
    [restart] (Restart)
    [exit] (Exit)
[end]
[end]
EOF
        fi
        
        fluxbox > /tmp/xvfb/fluxbox.log 2>&1 &
        sleep 2
        check_process "fluxbox" || log_warn "Fluxbox not running, but continuing..."
    else
        log_warn "Fluxbox not found, skipping window manager"
    fi
}

start_vnc_server() {
    if ! command -v x11vnc >/dev/null 2>&1; then
        log_warn "x11vnc not installed, VNC will not be available"
        return 1
    fi
    
    local vnc_started=false
    
    for attempt in $(seq 1 $MAX_RETRIES); do
        log_info "Starting x11vnc (attempt $attempt/$MAX_RETRIES)..."
        
        x11vnc -display :${DISPLAY_NUM} \
               -nopw \
               -listen localhost \
               -xkb \
               -ncache 10 \
               -ncache_cr \
               -forever \
               -shared \
               -rfbport ${VNC_PORT} \
               -o /tmp/xvfb/x11vnc.log \
               > /tmp/xvfb/x11vnc_stdout.log 2>&1 &
        
        sleep 3
        
        if check_process "x11vnc"; then
            vnc_started=true
            break
        else
            log_warn "x11vnc failed to start, attempt $attempt"
            [ -f /tmp/xvfb/x11vnc.log ] && tail -10 /tmp/xvfb/x11vnc.log
            sleep $RETRY_DELAY
        fi
    done
    
    [ "$vnc_started" = "true" ] && return 0 || return 1
}

start_websocket_proxy() {
    if ! command -v websockify >/dev/null 2>&1; then
        log_warn "websockify not installed, WebSocket proxy will not be available"
        return 1
    fi
    
    log_info "Starting WebSocket proxy..."
    
    # Check for NoVNC
    local novnc_path=""
    for path in /usr/share/novnc /usr/share/webapps/novnc /opt/novnc; do
        if [ -d "$path" ]; then
            novnc_path="$path"
            break
        fi
    done
    
    if [ -n "$novnc_path" ]; then
        log_info "Using NoVNC from: $novnc_path"
        # Copy custom index if exists (skip if no write permission)
        if [ -f "/usr/src/app/novnc-index.html" ] && [ -w "$novnc_path" ]; then
            cp /usr/src/app/novnc-index.html "$novnc_path/index.html"
        fi
        # Start websockify with NoVNC web files
        cd "$novnc_path"
        # Add verbose logging to debug WebSocket issues
        python3 -m websockify -v --web . 0.0.0.0:${WEBSOCKET_PORT} localhost:${VNC_PORT} > /tmp/xvfb/websockify.log 2>&1 &
        cd - > /dev/null
    else
        log_warn "NoVNC not found, starting websockify without web interface"
        python3 -m websockify 0.0.0.0:${WEBSOCKET_PORT} localhost:${VNC_PORT} > /tmp/xvfb/websockify.log 2>&1 &
    fi
    
    sleep 3
    check_process "websockify"
}

# Main execution
main() {
    log_info "Starting VNC setup..."
    
    # Setup
    setup_directories
    
    # Start Xvfb
    if ! start_xvfb; then
        log_error "Failed to start Xvfb, falling back to xvfb-run"
        exec xvfb-run -a -s "-screen 0 1024x768x16" "$@"
    fi
    
    # Start window manager (optional)
    start_window_manager
    
    # Start VNC server
    if start_vnc_server; then
        # Start WebSocket proxy only if VNC is running
        start_websocket_proxy
        
        log_info "VNC setup complete!"
        log_info "VNC is available on port ${VNC_PORT}"
        [ -n "$novnc_path" ] && log_info "NoVNC web interface: http://localhost:${WEBSOCKET_PORT}/vnc.html"
    else
        log_warn "VNC server not available, but X display is working"
    fi
    
    # Summary
    echo ""
    log_info "=== Service Status Summary ==="
    check_process "Xvfb :${DISPLAY_NUM}"
    check_process "fluxbox" || true
    check_process "x11vnc" || true
    check_process "websockify" || true
    echo ""
    
    # Execute the main application
    log_info "Starting main application..."
    exec "$@"
}

# Run main function with all arguments
main "$@"