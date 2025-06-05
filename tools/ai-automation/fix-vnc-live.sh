#!/bin/bash
# Live VNC fix script - run this inside the container without rebuilding

echo "=== Live VNC Fix Script ==="
echo "This script fixes VNC without rebuilding the container"
echo ""

# 1. Kill existing websockify
echo "1. Stopping existing websockify..."
pkill -f websockify || true
sleep 2

# 2. Try different websockify configurations
echo "2. Testing websockify configurations..."

# Get the pod name for kubectl exec
echo ""
echo "To run this script in your container:"
echo "kubectl exec -it <pod-name> -c ai-automation -- bash"
echo "Then run: /usr/src/app/fix-vnc-live.sh"
echo ""

# Configuration A: WebSocket only mode (no web server)
test_config_a() {
    echo "Config A: WebSocket-only mode on port 5900"
    cd /usr/share/novnc
    python3 -m websockify --verbose 0.0.0.0:5900 localhost:5901 &
    WEBSOCKIFY_PID=$!
    sleep 3
    
    echo "Test URL: http://localhost:30003/vnc/vnc.html?autoconnect=true&host=localhost&port=30003&path=vnc/"
    echo "Press Enter to stop and try next config..."
    read
    kill $WEBSOCKIFY_PID 2>/dev/null || true
}

# Configuration B: Web server mode with explicit path
test_config_b() {
    echo "Config B: Web server mode with root at /usr/share/novnc"
    cd /usr/share/novnc
    python3 -m websockify --verbose --web . 0.0.0.0:5900 localhost:5901 &
    WEBSOCKIFY_PID=$!
    sleep 3
    
    echo "Test URL: http://localhost:30003/vnc/"
    echo "Press Enter to stop and try next config..."
    read
    kill $WEBSOCKIFY_PID 2>/dev/null || true
}

# Configuration C: Token-based mode
test_config_c() {
    echo "Config C: Creating token configuration"
    echo "localhost:5901 vnc_token" > /tmp/vnc_tokens
    cd /usr/share/novnc
    python3 -m websockify --verbose --web . --token-plugin TokenFile --token-source /tmp/vnc_tokens 0.0.0.0:5900 &
    WEBSOCKIFY_PID=$!
    sleep 3
    
    echo "Test URL: http://localhost:30003/vnc/vnc.html?autoconnect=true&token=vnc_token"
    echo "Press Enter to stop and try next config..."
    read
    kill $WEBSOCKIFY_PID 2>/dev/null || true
}

# Quick fix attempt
quick_fix() {
    echo "Quick Fix: Trying the most likely working configuration"
    
    # Create a simple HTML redirector
    cat > /usr/share/novnc/connect.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>VNC Connect</title>
    <script>
        // Force connection to the WebSocket endpoint
        const params = new URLSearchParams({
            autoconnect: 'true',
            host: window.location.hostname,
            port: window.location.port,
            path: '',  // Empty path is crucial
            encrypt: 'false'
        });
        window.location.href = 'vnc.html?' + params.toString();
    </script>
</head>
<body>Connecting...</body>
</html>
EOF

    # Start websockify in the most compatible mode
    cd /usr/share/novnc
    python3 -m websockify -v --web . 0.0.0.0:5900 localhost:5901 > /tmp/websockify-fix.log 2>&1 &
    
    echo ""
    echo "Quick fix applied! Try these URLs:"
    echo "1. http://localhost:30003/vnc/connect.html"
    echo "2. http://localhost:30003/vnc/vnc_lite.html"
    echo ""
    echo "Websockify log: tail -f /tmp/websockify-fix.log"
}

# Menu
echo "Choose an option:"
echo "1. Test Config A (WebSocket only)"
echo "2. Test Config B (Web server mode)"
echo "3. Test Config C (Token mode)"
echo "4. Quick Fix (recommended)"
echo "5. Show current processes"
read -p "Enter choice: " choice

case $choice in
    1) test_config_a ;;
    2) test_config_b ;;
    3) test_config_c ;;
    4) quick_fix ;;
    5) ps aux | grep -E "(websockify|x11vnc|Xvfb)" | grep -v grep ;;
    *) echo "Invalid choice" ;;
esac