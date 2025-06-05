#!/bin/bash

# VNC startup script with better websockify handling

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

# Start Xvfb
echo "Starting Xvfb..."
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset > /tmp/xvfb.log 2>&1 &
XVFB_PID=$!
sleep 3

# Check if Xvfb started successfully
if check_process "Xvfb :99"; then
    echo "Xvfb started successfully"
else
    echo "ERROR: Xvfb failed to start. Check /tmp/xvfb.log"
    cat /tmp/xvfb.log
    exit 1
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

# Start websockify with correct parameters
echo "Starting websockify..."
# First, let's create a simple index.html if vnc.html doesn't exist
if [ -f "/usr/share/novnc/vnc.html" ]; then
    echo "Found NoVNC at /usr/share/novnc"
    cd /usr/share/novnc
    # Use the built-in websockify with explicit host binding
    python3 -m websockify --web . --host 0.0.0.0 5900 localhost:5901 > /tmp/websockify.log 2>&1 &
else
    echo "NoVNC not found, running websockify without web interface"
    python3 -m websockify --host 0.0.0.0 5900 localhost:5901 > /tmp/websockify.log 2>&1 &
fi
WEBSOCKIFY_PID=$!
sleep 3

# Check if websockify started successfully
if check_process "websockify"; then
    echo "websockify started successfully"
    echo "NoVNC should be accessible at http://localhost:5900/vnc.html"
    echo "WebSocket endpoint at ws://localhost:5900/"
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
echo "=== Websockify Log ==="
tail -5 /tmp/websockify.log
echo ""
echo "VNC setup complete. Starting application..."

# Start the actual application
exec npm run dev