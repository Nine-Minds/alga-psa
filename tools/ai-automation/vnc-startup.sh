#!/bin/bash

# VNC startup script with better error handling and logging

echo "=== VNC Startup Script ==="
echo "Starting at: $(date)"

# Function to check if a process is running
check_process() {
    local process_name=$1
    if pgrep -f "$process_name" > /dev/null; then
        echo "✓ $process_name is running (PID: $(pgrep -f "$process_name"))"
        return 0
    else
        echo "✗ $process_name is NOT running"
        return 1
    fi
}

# Set display
export DISPLAY=:99
echo "Display set to: $DISPLAY"

# Clean up any existing X server artifacts
echo "Cleaning up any existing X server..."
pkill -f "Xvfb :99" 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true

# Create necessary directories
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix

# Start Xvfb with more conservative settings for Kubernetes
echo "Starting Xvfb..."
# Start with minimal settings that are known to work in Kubernetes
Xvfb :99 -screen 0 1024x768x16 -ac > /tmp/xvfb.log 2>&1 &
XVFB_PID=$!
sleep 5

# Check if Xvfb started successfully
if check_process "Xvfb :99"; then
    echo "Xvfb started successfully"
else
    echo "ERROR: Xvfb failed to start. Trying fallback options..."
    cat /tmp/xvfb.log
    echo ""
    echo "Attempting to start Xvfb with minimal settings..."
    # Try even more minimal settings
    Xvfb :99 -screen 0 1024x768x16 +extension RANDR > /tmp/xvfb-fallback.log 2>&1 &
    XVFB_PID=$!
    sleep 5
    
    if check_process "Xvfb :99"; then
        echo "Xvfb started with fallback settings"
    else
        echo "ERROR: Xvfb failed to start even with fallback settings"
        cat /tmp/xvfb-fallback.log
        exit 1
    fi
fi

# Test the display
echo "Testing display..."
if xdpyinfo -display :99 > /tmp/xdpyinfo.log 2>&1; then
    echo "✓ Display :99 is working"
else
    echo "✗ Display :99 is NOT working. Check /tmp/xdpyinfo.log"
    cat /tmp/xdpyinfo.log
fi

# Start fluxbox window manager
echo "Starting fluxbox..."
fluxbox > /tmp/fluxbox.log 2>&1 &
FLUXBOX_PID=$!
sleep 2

check_process "fluxbox"

# Start x11vnc
echo "Starting x11vnc..."
x11vnc -display :99 -nopw -listen localhost -xkb -ncache 10 -forever -shared -rfbport 5901 -o /tmp/x11vnc.log > /tmp/x11vnc_stdout.log 2>&1 &
X11VNC_PID=$!
sleep 3

# Check if x11vnc started successfully
if check_process "x11vnc"; then
    echo "x11vnc started successfully"
else
    echo "ERROR: x11vnc failed to start. Logs:"
    echo "=== x11vnc.log ==="
    cat /tmp/x11vnc.log 2>/dev/null || echo "No log file"
    echo "=== x11vnc_stdout.log ==="
    cat /tmp/x11vnc_stdout.log 2>/dev/null || echo "No stdout log"
    exit 1
fi

# Start websockify
echo "Starting websockify..."
# Check for NoVNC location
if [ -d "/usr/share/novnc" ]; then
    NOVNC_PATH="/usr/share/novnc"
elif [ -d "/usr/share/webapps/novnc" ]; then
    NOVNC_PATH="/usr/share/webapps/novnc"
else
    echo "WARNING: NoVNC not found, running websockify without web interface"
    NOVNC_PATH=""
fi

if [ -n "$NOVNC_PATH" ]; then
    echo "Using NoVNC from: $NOVNC_PATH"
    (cd $NOVNC_PATH && python3 -m websockify --web . 0.0.0.0:5900 localhost:5901 > /tmp/websockify.log 2>&1 &)
else
    python3 -m websockify 0.0.0.0:5900 localhost:5901 > /tmp/websockify.log 2>&1 &
fi
WEBSOCKIFY_PID=$!
sleep 3

# Check if websockify started successfully
if check_process "websockify"; then
    echo "websockify started successfully"
    echo "NoVNC should be accessible at http://localhost:5900/vnc.html"
else
    echo "ERROR: websockify failed to start. Check /tmp/websockify.log"
    cat /tmp/websockify.log
    exit 1
fi

echo ""
echo "=== VNC Services Status ==="
check_process "Xvfb :99"
check_process "fluxbox"
check_process "x11vnc"
check_process "websockify"
echo ""
echo "VNC setup complete. Starting application..."

# Start the actual application
exec npm run dev