#!/bin/bash

# Fix VNC in running container

echo "=== Fixing VNC in Container ==="

# Kill existing websockify
echo "Stopping existing websockify..."
docker exec vnc-test pkill -f websockify

sleep 2

# Start websockify with simpler command
echo "Starting websockify with fixed configuration..."
docker exec -d vnc-test bash -c 'cd /usr/share/novnc && python3 -m websockify --web . 5900 localhost:5901 > /tmp/websockify-new.log 2>&1'

sleep 3

# Check if it's running
echo "Checking websockify status..."
docker exec vnc-test ps aux | grep websockify | grep -v grep

# Test the web interface
echo ""
echo "Testing web interface..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:5900/vnc.html || echo "Failed to connect"

# Show new logs
echo ""
echo "Websockify logs:"
docker exec vnc-test cat /tmp/websockify-new.log