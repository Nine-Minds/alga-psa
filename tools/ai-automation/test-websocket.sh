#!/bin/bash

# Simple test script to debug WebSocket connectivity

echo "=== WebSocket Debugging Script ==="
echo ""

# Check if websockify is running
echo "1. Checking websockify process:"
if pgrep -f websockify > /dev/null; then
    echo "   ✓ websockify is running"
    ps aux | grep websockify | grep -v grep
else
    echo "   ✗ websockify is NOT running"
fi
echo ""

# Check if x11vnc is running
echo "2. Checking x11vnc process:"
if pgrep -f x11vnc > /dev/null; then
    echo "   ✓ x11vnc is running"
    ps aux | grep x11vnc | grep -v grep
else
    echo "   ✗ x11vnc is NOT running"
fi
echo ""

# Check port bindings
echo "3. Checking port bindings:"
echo "   Port 5900 (WebSocket):"
netstat -tlnp 2>/dev/null | grep :5900 || ss -tlnp | grep :5900 || echo "   Unable to check (need elevated permissions)"
echo "   Port 5901 (VNC):"
netstat -tlnp 2>/dev/null | grep :5901 || ss -tlnp | grep :5901 || echo "   Unable to check (need elevated permissions)"
echo ""

# Check websockify logs
echo "4. Last 20 lines of websockify log:"
if [ -f /tmp/xvfb/websockify.log ]; then
    tail -20 /tmp/xvfb/websockify.log
else
    echo "   Log file not found at /tmp/xvfb/websockify.log"
fi
echo ""

# Test WebSocket connection
echo "5. Testing WebSocket connection:"
if command -v python3 >/dev/null 2>&1; then
    python3 -c "
import websocket
import sys

try:
    ws = websocket.create_connection('ws://localhost:5900/', subprotocols=['binary'], timeout=5)
    print('   ✓ WebSocket connection successful!')
    ws.close()
except Exception as e:
    print(f'   ✗ WebSocket connection failed: {e}')
"
else
    echo "   Python3 not available for WebSocket test"
fi
echo ""

# Check for NoVNC files
echo "6. Checking NoVNC installation:"
for path in /usr/share/novnc /usr/share/webapps/novnc /opt/novnc; do
    if [ -d "$path" ]; then
        echo "   ✓ NoVNC found at: $path"
        ls -la "$path/vnc.html" 2>/dev/null || echo "     - vnc.html not found"
    fi
done
echo ""

echo "=== End of diagnostics ==="