#!/bin/bash
# Direct VNC fix by restarting websockify

NAMESPACE="alga-dev-feat-bbl14"
POD_NAME="alga-dev-feat-bbl14-ai-api-6475cdc769-pw5t4"

echo "=== Direct VNC Fix ==="
echo ""

# Check current websockify
echo "1. Current websockify process:"
kubectl exec -it $POD_NAME -n $NAMESPACE -c ai-automation-api -- ps aux | grep -E "websockify|x11vnc" | grep -v grep
echo ""

# Get into the pod and fix it
echo "2. Restarting websockify with working configuration..."
kubectl exec -it $POD_NAME -n $NAMESPACE -c ai-automation-api -- bash -c '
# Kill existing websockify
pkill -f websockify || true
sleep 2

# Find where NoVNC is installed
NOVNC_PATH="/usr/share/novnc"
if [ ! -d "$NOVNC_PATH" ]; then
    echo "NoVNC not found at $NOVNC_PATH"
    exit 1
fi

# Create a working connection file in a writable location
cd $NOVNC_PATH
if [ -w . ]; then
    TARGET_DIR="."
else
    TARGET_DIR="/tmp"
    echo "NoVNC dir not writable, using /tmp"
fi

# Restart websockify with explicit settings
echo "Starting websockify..."
cd $NOVNC_PATH
python3 -m websockify -v --web . 0.0.0.0:5900 localhost:5901 > /tmp/websockify-new.log 2>&1 &

sleep 3

# Check if it started
if pgrep -f websockify > /dev/null; then
    echo "✓ Websockify restarted successfully"
else
    echo "✗ Failed to start websockify"
    echo "Last 10 lines of log:"
    tail -10 /tmp/websockify-new.log
fi
'

echo ""
echo "3. Creating test URLs..."
echo ""
echo "Try these in order:"
echo "a) http://localhost:30003/vnc/vnc.html?autoconnect=true&host=localhost&port=30003&path="
echo "b) http://localhost:30003/vnc/vnc_lite.html?host=localhost&port=30003&path="
echo "c) http://localhost:30003/vnc/vnc.html?autoconnect=true"
echo ""
echo "The key is the empty 'path' parameter!"