#!/bin/bash
# Test each stage of the VNC connection

NAMESPACE="alga-dev-feat-bbl14"
POD_NAME="alga-dev-feat-bbl14-ai-api-6475cdc769-pw5t4"

echo "=== Testing VNC Connection Stages ==="
echo ""

# Stage 1: Check if websockify is running
echo "Stage 1: Check websockify process"
kubectl exec $POD_NAME -n $NAMESPACE -c ai-automation-api -- ps aux | grep websockify | grep -v grep
if [ $? -eq 0 ]; then
    echo "✅ Websockify is running"
else
    echo "❌ Websockify is NOT running - restarting..."
    kubectl exec $POD_NAME -n $NAMESPACE -c ai-automation-api -- bash -c "cd /usr/share/novnc && python3 -m websockify -v --web . 0.0.0.0:5900 localhost:5901 > /tmp/websockify-new.log 2>&1 &"
    sleep 3
fi
echo ""

# Stage 2: Check x11vnc
echo "Stage 2: Check x11vnc process"
kubectl exec $POD_NAME -n $NAMESPACE -c ai-automation-api -- ps aux | grep x11vnc | grep -v grep
if [ $? -eq 0 ]; then
    echo "✅ x11vnc is running"
else
    echo "❌ x11vnc is NOT running"
fi
echo ""

# Stage 3: Test direct connection to websockify from inside pod
echo "Stage 3: Test websockify from inside pod"
kubectl exec $POD_NAME -n $NAMESPACE -c ai-automation-api -- bash -c "curl -s -o /dev/null -w '%{http_code}' http://localhost:5900/" || echo "Failed"
echo ""

# Stage 4: Test WebSocket upgrade from inside pod
echo "Stage 4: Test WebSocket from inside pod"
kubectl exec $POD_NAME -n $NAMESPACE -c ai-automation-api -- bash -c 'python3 -c "
import websocket
try:
    ws = websocket.create_connection(\"ws://localhost:5900/\", timeout=2)
    print(\"✅ Direct WebSocket connection works\")
    ws.close()
except Exception as e:
    print(f\"❌ Direct WebSocket failed: {e}\")
"'
echo ""

# Stage 5: Check what URL NoVNC is trying
echo "Stage 5: Test from outside through nginx"
echo "Testing: http://localhost:30003/vnc/"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:30003/vnc/
echo ""

# Stage 6: Show the working test URL
echo "Stage 6: The URL that should work"
echo "Based on your test-ws.html success, this WebSocket works:"
echo "ws://localhost:30003/vnc/"
echo ""
echo "So NoVNC should connect with these parameters:"
echo "http://localhost:30003/vnc/vnc.html?autoconnect=true&host=localhost&port=30003&path=&encrypt=false"
echo ""
echo "The critical part is: path= (empty but present)"