#!/bin/bash
# Fast VNC testing without container rebuild

echo "=== Fast VNC Testing Script ==="
echo ""
echo "This script helps you test VNC configurations without rebuilding containers"
echo ""

# Get namespace and pod name
read -p "Enter namespace: " NAMESPACE
read -p "Enter pod name (or part of it): " POD_SEARCH

# Find the full pod name
POD_NAME=$(kubectl get pods -n $NAMESPACE | grep $POD_SEARCH | grep Running | head -1 | awk '{print $1}')

if [ -z "$POD_NAME" ]; then
    echo "Error: Pod not found"
    exit 1
fi

echo "Found pod: $POD_NAME"
echo ""

# Function to copy file to pod
copy_to_pod() {
    local file=$1
    echo "Copying $file to pod..."
    kubectl cp $file $NAMESPACE/$POD_NAME:/usr/share/novnc/$(basename $file) -c ai-automation-api
}

# Function to exec command in pod
exec_in_pod() {
    kubectl exec -it $POD_NAME -n $NAMESPACE -c ai-automation-api -- bash -c "$1"
}

# Menu
while true; do
    echo ""
    echo "Options:"
    echo "1. Copy test files to pod"
    echo "2. Check VNC status in pod"
    echo "3. Restart websockify with logging"
    echo "4. View websockify logs"
    echo "5. Test WebSocket from inside pod"
    echo "6. Apply quick fix"
    echo "7. Exit"
    echo ""
    read -p "Choose option: " choice
    
    case $choice in
        1)
            echo "Copying test files..."
            copy_to_pod vnc-quick-test.html
            copy_to_pod fix-vnc-live.sh
            exec_in_pod "chmod +x /usr/share/novnc/fix-vnc-live.sh"
            echo "Files copied! Access at: http://localhost:30003/vnc/quick-test.html"
            ;;
        2)
            echo "Checking VNC status..."
            exec_in_pod "ps aux | grep -E '(websockify|x11vnc|Xvfb)' | grep -v grep"
            ;;
        3)
            echo "Restarting websockify with verbose logging..."
            exec_in_pod "pkill -f websockify || true"
            sleep 2
            exec_in_pod "cd /usr/share/novnc && python3 -m websockify -vv --web . 0.0.0.0:5900 localhost:5901 > /tmp/websockify-debug.log 2>&1 &"
            echo "Websockify restarted with debug logging"
            ;;
        4)
            echo "Websockify logs:"
            exec_in_pod "tail -30 /tmp/websockify-debug.log || tail -30 /tmp/xvfb/websockify.log"
            ;;
        5)
            echo "Testing WebSocket from inside pod..."
            exec_in_pod "python3 -c \"
import websocket
try:
    ws = websocket.create_connection('ws://localhost:5900/', timeout=5)
    print('✓ Local WebSocket connection successful!')
    ws.close()
except Exception as e:
    print(f'✗ Local WebSocket failed: {e}')
\""
            ;;
        6)
            echo "Applying quick fix..."
            exec_in_pod "cd /usr/share/novnc && cat > connect.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
<script>
window.location.href = 'vnc.html?autoconnect=true&host=' + window.location.hostname + '&port=' + window.location.port + '&path=&encrypt=false';
</script>
</head>
</html>
EOF"
            echo "Quick fix applied! Try: http://localhost:30003/vnc/connect.html"
            ;;
        7)
            echo "Exiting..."
            exit 0
            ;;
        *)
            echo "Invalid choice"
            ;;
    esac
done