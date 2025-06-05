#!/bin/bash

# VNC startup script optimized for Kubernetes environments

echo "=== VNC Startup Script (Kubernetes Optimized) ==="
echo "Starting at: $(date)"
echo "Environment: Kubernetes/Container"

# Function to check if a process is running
check_process() {
    local process_name=$1
    if pgrep -f "$process_name" > /dev/null; then
        echo "✓ $process_name is running (PID: $(pgrep -f "$process_name" | head -1))"
        return 0
    else
        echo "✗ $process_name is NOT running"
        return 1
    fi
}

# Create necessary directories
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix

# Set display
export DISPLAY=:99
echo "Display set to: $DISPLAY"

# Kill any existing Xvfb processes
pkill -f "Xvfb :99" 2>/dev/null || true
sleep 1

# Try to start Xvfb with various fallback options
echo "Starting Xvfb..."
XVFB_STARTED=false

# Option 1: Try with environment variables
if [ -n "$XVFB_WHD" ] && [ -n "$XVFB_ARGS" ]; then
    echo "Trying Xvfb with environment settings: $XVFB_WHD $XVFB_ARGS"
    Xvfb :99 -screen 0 $XVFB_WHD $XVFB_ARGS > /tmp/xvfb.log 2>&1 &
    XVFB_PID=$!
    sleep 3
    
    if check_process "Xvfb :99"; then
        XVFB_STARTED=true
        echo "Xvfb started with environment settings"
    fi
fi

# Option 2: Try minimal settings
if [ "$XVFB_STARTED" = "false" ]; then
    echo "Trying Xvfb with minimal settings..."
    Xvfb :99 -screen 0 1024x768x16 -ac > /tmp/xvfb-minimal.log 2>&1 &
    XVFB_PID=$!
    sleep 3
    
    if check_process "Xvfb :99"; then
        XVFB_STARTED=true
        echo "Xvfb started with minimal settings"
    else
        cat /tmp/xvfb-minimal.log
    fi
fi

# Option 3: Try with xvfb-run as last resort
if [ "$XVFB_STARTED" = "false" ]; then
    echo "ERROR: Could not start Xvfb directly. VNC will not be available."
    echo "Falling back to xvfb-run for the application..."
    # Run the rest of the application with xvfb-run
    exec xvfb-run -a -s "-screen 0 1024x768x16" npm run dev
fi

# Test the display
echo "Testing display..."
export DISPLAY=:99
if xdpyinfo > /tmp/xdpyinfo.log 2>&1; then
    echo "✓ Display :99 is working"
else
    echo "⚠️  Display test failed, but continuing..."
    cat /tmp/xdpyinfo.log
fi

# Start fluxbox window manager (optional, but helps with some applications)
echo "Starting fluxbox..."
fluxbox > /tmp/fluxbox.log 2>&1 &
FLUXBOX_PID=$!
sleep 2

# Don't fail if fluxbox doesn't start - it's optional
check_process "fluxbox" || echo "⚠️  Fluxbox not running, but continuing..."

# Start x11vnc with retry logic
echo "Starting x11vnc..."
X11VNC_STARTED=false
for attempt in 1 2 3; do
    echo "Attempt $attempt to start x11vnc..."
    x11vnc -display :99 -nopw -listen localhost -xkb -ncache 10 -forever -shared -rfbport 5901 > /tmp/x11vnc.log 2>&1 &
    X11VNC_PID=$!
    sleep 3
    
    if check_process "x11vnc"; then
        X11VNC_STARTED=true
        echo "x11vnc started successfully on attempt $attempt"
        break
    else
        echo "x11vnc failed on attempt $attempt"
        cat /tmp/x11vnc.log | tail -10
    fi
done

if [ "$X11VNC_STARTED" = "false" ]; then
    echo "ERROR: x11vnc failed to start after 3 attempts"
    echo "VNC will not be available, but continuing with application startup..."
fi

# Start websockify only if x11vnc is running
if [ "$X11VNC_STARTED" = "true" ]; then
    echo "Starting websockify..."
    if [ -d "/usr/share/novnc" ]; then
        echo "Using NoVNC from: /usr/share/novnc"
        (cd /usr/share/novnc && python3 -m websockify --web . 0.0.0.0:5900 localhost:5901 > /tmp/websockify.log 2>&1 &)
        sleep 3
        
        if check_process "websockify"; then
            echo "websockify started successfully"
            echo "VNC should be accessible via WebSocket at ws://localhost:5900/"
        else
            echo "⚠️  websockify failed to start"
            cat /tmp/websockify.log | tail -10
        fi
    else
        echo "⚠️  NoVNC not found, WebSocket proxy not available"
    fi
fi

echo ""
echo "=== Service Status Summary ==="
check_process "Xvfb :99" || echo "❌ Xvfb not running"
check_process "fluxbox" || echo "⚠️  Fluxbox not running (optional)"
check_process "x11vnc" || echo "❌ x11vnc not running"
check_process "websockify" || echo "⚠️  websockify not running"
echo ""

# Always start the application, regardless of VNC status
echo "Starting application..."
exec npm run dev