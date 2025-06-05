#!/bin/bash

# VNC startup script specifically fixed for Kubernetes DRI driver issues

echo "=== VNC Startup Script (K8s DRI Fix) ==="
echo "Starting at: $(date)"
echo "Running as: $(id)"

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

# Set display
export DISPLAY=:99
echo "Display set to: $DISPLAY"

# Fix for DRI driver issues in Kubernetes
echo "Setting up DRI driver workarounds..."

# Create necessary directories
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix
mkdir -p /tmp/xvfb

# Set environment variables to avoid DRI driver issues
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export LP_NO_RAST=false
export LIBGL_DRI3_DISABLE=1
export LIBGL_ALWAYS_INDIRECT=1

# Alternative: completely disable hardware acceleration
export LIBGL_DRIVERS_PATH=/nonexistent

# Clean up any existing X server artifacts
echo "Cleaning up any existing X server..."
pkill -f "Xvfb :99" 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
sleep 1

# Try multiple Xvfb configurations with software rendering focus
declare -a configs=(
    # Minimal configuration with software rendering
    "-screen 0 1024x768x16 +extension GLX +extension RANDR +extension RENDER -ac"
    # Try without any extensions
    "-screen 0 1024x768x16 -extension GLX -extension RANDR -ac"
    # Absolute minimal
    "-screen 0 640x480x8 -ac"
    # Try with explicit noreset
    "-screen 0 1024x768x16 -ac -noreset"
)

echo "Attempting to start Xvfb with software rendering..."

for config in "${configs[@]}"; do
    echo "Trying configuration: $config"
    
    # Start Xvfb with error output redirected
    Xvfb :99 $config > /tmp/xvfb/xvfb.log 2>&1 &
    XVFB_PID=$!
    
    # Give it time to start
    sleep 3
    
    # Check if it's still running
    if kill -0 $XVFB_PID 2>/dev/null; then
        echo "✓ Xvfb started successfully with configuration: $config"
        
        # Test the display
        if timeout 5 xdpyinfo -display :99 > /tmp/xvfb/xdpyinfo.log 2>&1; then
            echo "✓ Display :99 is working"
            break
        else
            echo "⚠️ Display test failed, but Xvfb is running"
            # Continue anyway as display might work for applications
            break
        fi
    else
        echo "✗ Xvfb failed with this configuration"
        if [ -f /tmp/xvfb/xvfb.log ]; then
            echo "Error output (last 10 lines):"
            tail -10 /tmp/xvfb/xvfb.log
        fi
    fi
done

# Check if we have a running Xvfb
if ! check_process "Xvfb :99"; then
    echo "ERROR: Failed to start Xvfb with any configuration"
    echo ""
    echo "Attempting fallback: Xdummy driver"
    
    # Try with Xdummy as a last resort
    if command -v Xorg &> /dev/null; then
        # Create minimal xorg.conf for dummy driver
        cat > /tmp/xorg.conf <<EOF
Section "Device"
    Identifier "dummy"
    Driver "dummy"
    VideoRam 256000
EndSection

Section "Screen"
    Identifier "dummy_screen"
    Device "dummy"
    Monitor "dummy_monitor"
    DefaultDepth 24
    SubSection "Display"
        Viewport 0 0
        Depth 24
        Modes "1024x768"
    EndSubSection
EndSection

Section "Monitor"
    Identifier "dummy_monitor"
    HorizSync 30-70
    VertRefresh 50-75
EndSection
EOF
        
        echo "Starting Xorg with dummy driver..."
        Xorg :99 -config /tmp/xorg.conf > /tmp/xvfb/xorg.log 2>&1 &
        XORG_PID=$!
        sleep 3
        
        if kill -0 $XORG_PID 2>/dev/null; then
            echo "✓ Xorg with dummy driver started"
        else
            echo "ERROR: All display server attempts failed"
            exit 1
        fi
    else
        echo "ERROR: Xorg not available for fallback"
        exit 1
    fi
fi

# Start fluxbox window manager
echo "Starting fluxbox..."
fluxbox > /tmp/xvfb/fluxbox.log 2>&1 &
FLUXBOX_PID=$!
sleep 2

check_process "fluxbox"

# Start x11vnc
echo "Starting x11vnc..."
x11vnc -display :99 -nopw -listen localhost -xkb -ncache 10 -ncache_cr -forever -shared -rfbport 5901 -o /tmp/xvfb/x11vnc.log > /tmp/xvfb/x11vnc_stdout.log 2>&1 &
X11VNC_PID=$!
sleep 3

if check_process "x11vnc"; then
    echo "x11vnc started successfully"
else
    echo "ERROR: x11vnc failed to start"
    cat /tmp/xvfb/x11vnc.log 2>/dev/null || echo "No x11vnc log"
fi

# Start websockify
echo "Starting websockify..."
if [ -d "/usr/share/novnc" ]; then
    NOVNC_PATH="/usr/share/novnc"
elif [ -d "/usr/share/webapps/novnc" ]; then
    NOVNC_PATH="/usr/share/webapps/novnc"
else
    echo "WARNING: NoVNC not found"
    NOVNC_PATH=""
fi

if [ -n "$NOVNC_PATH" ]; then
    echo "Using NoVNC from: $NOVNC_PATH"
    (cd $NOVNC_PATH && python3 -m websockify --web . 0.0.0.0:5900 localhost:5901 > /tmp/xvfb/websockify.log 2>&1 &)
else
    python3 -m websockify 0.0.0.0:5900 localhost:5901 > /tmp/xvfb/websockify.log 2>&1 &
fi
WEBSOCKIFY_PID=$!
sleep 3

check_process "websockify"

echo ""
echo "=== VNC Services Status ==="
check_process "Xvfb :99" || check_process "Xorg :99"
check_process "fluxbox"
check_process "x11vnc"
check_process "websockify"
echo ""
echo "VNC setup complete. Starting application..."

# Start the actual application
exec npm run dev