#!/bin/bash

# VNC startup script with separate web server and WebSocket proxy
# This fixes the issue where WebSocket connections close immediately

echo "=== VNC Startup with WebSocket Fix ==="
echo "Starting at: $(date)"

# Configuration
DISPLAY_NUM=99
export DISPLAY=:${DISPLAY_NUM}
VNC_PORT=5901
WEB_PORT=5900
WEBSOCKET_PORT=5999

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

# Setup directories
setup_directories() {
    log_info "Setting up directories..."
    mkdir -p /tmp/.X11-unix /tmp/.ICE-unix /tmp/xvfb
    chmod 1777 /tmp/.X11-unix /tmp/.ICE-unix
    chmod 777 /tmp/xvfb
}

# Start Xvfb
start_xvfb() {
    log_info "Starting Xvfb..."
    
    # Force software rendering
    export LIBGL_ALWAYS_SOFTWARE=1
    export GALLIUM_DRIVER=llvmpipe
    
    Xvfb :${DISPLAY_NUM} -screen 0 1280x1024x16 -ac -nolisten tcp > /tmp/xvfb/xvfb.log 2>&1 &
    sleep 3
    
    if pgrep -f "Xvfb :${DISPLAY_NUM}" > /dev/null; then
        log_info "Xvfb started successfully"
        return 0
    else
        log_error "Failed to start Xvfb"
        return 1
    fi
}

# Start window manager
start_window_manager() {
    log_info "Starting window manager..."
    if command -v fluxbox >/dev/null 2>&1; then
        fluxbox > /tmp/xvfb/fluxbox.log 2>&1 &
        sleep 2
        log_info "Fluxbox started"
    fi
}

# Start VNC server
start_vnc_server() {
    log_info "Starting x11vnc..."
    
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
    
    if pgrep -f "x11vnc" > /dev/null; then
        log_info "x11vnc started on port ${VNC_PORT}"
        return 0
    else
        log_error "Failed to start x11vnc"
        return 1
    fi
}

# Start NoVNC web server (without WebSocket proxy)
start_novnc_web() {
    log_info "Starting NoVNC web server..."
    
    local novnc_path="/usr/share/novnc"
    if [ ! -d "$novnc_path" ]; then
        log_error "NoVNC not found at $novnc_path"
        return 1
    fi
    
    # Start a simple Python HTTP server for NoVNC files
    cd "$novnc_path"
    python3 -m http.server ${WEB_PORT} > /tmp/xvfb/novnc-web.log 2>&1 &
    cd - > /dev/null
    
    sleep 2
    log_info "NoVNC web server started on port ${WEB_PORT}"
}

# Start WebSocket proxy separately
start_websocket_proxy() {
    log_info "Starting WebSocket proxy..."
    
    # Start websockify in WebSocket-only mode (no web server)
    # This prevents conflicts with NoVNC's WebSocket expectations
    python3 -m websockify \
        --verbose \
        --web-auth=False \
        0.0.0.0:${WEBSOCKET_PORT} \
        localhost:${VNC_PORT} \
        > /tmp/xvfb/websockify.log 2>&1 &
    
    sleep 3
    
    if pgrep -f "websockify" > /dev/null; then
        log_info "WebSocket proxy started on port ${WEBSOCKET_PORT}"
        return 0
    else
        log_error "Failed to start WebSocket proxy"
        tail -20 /tmp/xvfb/websockify.log
        return 1
    fi
}

# Create nginx configuration for proper routing
create_nginx_config() {
    log_info "Creating nginx configuration..."
    
    cat > /tmp/xvfb/nginx-vnc.conf << EOF
events {
    worker_connections 1024;
}

http {
    map \$http_upgrade \$connection_upgrade {
        default upgrade;
        '' close;
    }
    
    server {
        listen ${WEB_PORT};
        
        # Serve NoVNC static files
        location / {
            root /usr/share/novnc;
            try_files \$uri \$uri/ /vnc.html;
        }
        
        # WebSocket proxy to websockify
        location /websockify {
            proxy_pass http://localhost:${WEBSOCKET_PORT}/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection \$connection_upgrade;
            
            # Disable buffering
            proxy_buffering off;
            proxy_request_buffering off;
            
            # Timeouts
            proxy_connect_timeout 3600s;
            proxy_send_timeout 3600s;
            proxy_read_timeout 3600s;
        }
    }
}
EOF

    # Start nginx if available
    if command -v nginx >/dev/null 2>&1; then
        nginx -c /tmp/xvfb/nginx-vnc.conf > /tmp/xvfb/nginx.log 2>&1 &
        sleep 2
        log_info "Nginx started for VNC routing"
        return 0
    else
        log_warn "Nginx not available, using separate ports"
        return 1
    fi
}

# Main execution
main() {
    log_info "Starting VNC setup with WebSocket fix..."
    
    # Setup
    setup_directories
    
    # Start Xvfb
    if ! start_xvfb; then
        log_error "Critical: Failed to start Xvfb"
        exit 1
    fi
    
    # Start window manager
    start_window_manager
    
    # Start VNC server
    if ! start_vnc_server; then
        log_error "Critical: Failed to start VNC server"
        exit 1
    fi
    
    # Try nginx first, fallback to separate servers
    if ! create_nginx_config; then
        # Fallback: start separate web and WebSocket servers
        start_novnc_web
        start_websocket_proxy
        
        log_info "=== VNC Access Information ==="
        log_info "NoVNC web interface: http://localhost:${WEB_PORT}/vnc.html"
        log_info "WebSocket endpoint: ws://localhost:${WEBSOCKET_PORT}/"
        log_info "Direct VNC port: ${VNC_PORT}"
        log_info ""
        log_info "To connect, use: http://localhost:${WEB_PORT}/vnc.html?host=localhost&port=${WEBSOCKET_PORT}"
    else
        log_info "=== VNC Access Information ==="
        log_info "NoVNC interface: http://localhost:${WEB_PORT}/"
        log_info "WebSocket proxy integrated at: /websockify"
    fi
    
    # Summary
    echo ""
    log_info "=== Service Status Summary ==="
    pgrep -f "Xvfb :${DISPLAY_NUM}" > /dev/null && log_info "✓ Xvfb running" || log_error "✗ Xvfb not running"
    pgrep -f "fluxbox" > /dev/null && log_info "✓ Fluxbox running" || log_warn "- Fluxbox not running"
    pgrep -f "x11vnc" > /dev/null && log_info "✓ x11vnc running" || log_error "✗ x11vnc not running"
    pgrep -f "websockify" > /dev/null && log_info "✓ WebSocket proxy running" || log_error "✗ WebSocket proxy not running"
    pgrep -f "nginx" > /dev/null && log_info "✓ Nginx running" || log_info "- Nginx not running (using fallback)"
    echo ""
    
    # Execute the main application
    log_info "Starting main application..."
    exec "$@"
}

# Run main function with all arguments
main "$@"