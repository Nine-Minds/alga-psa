#!/bin/bash
# Quick VNC fix - run this directly

NAMESPACE="alga-dev-feat-bbl14"
POD_NAME="alga-dev-feat-bbl14-ai-api-6475cdc769-pw5t4"

echo "Applying VNC fix to pod: $POD_NAME"

# Create the fix file directly in the pod
kubectl exec -it $POD_NAME -n $NAMESPACE -c ai-automation-api -- bash -c "cd /tmp && cat > fix.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
<title>VNC Fix</title>
<script>
// This works based on your test-ws.html success
// Empty path is the key
window.location.href = 'vnc.html?autoconnect=true&host=' + window.location.hostname + '&port=' + window.location.port + '&path=&encrypt=false';
</script>
</head>
<body>Redirecting to VNC...</body>
</html>
EOF"

# Also create a vnc_lite version
kubectl exec -it $POD_NAME -n $NAMESPACE -c ai-automation-api -- bash -c "cat > /usr/share/novnc/lite.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
<title>VNC Lite</title>
<script>
window.location.href = 'vnc_lite.html?host=' + window.location.hostname + '&port=' + window.location.port + '&path=&encrypt=false';
</script>
</head>
<body>Redirecting to VNC Lite...</body>
</html>
EOF"

echo ""
echo "Fix applied! Try these URLs:"
echo "1. http://localhost:30003/vnc/fix.html"
echo "2. http://localhost:30003/vnc/lite.html"
echo ""
echo "Also check websockify status:"
kubectl exec -it $POD_NAME -n $NAMESPACE -c ai-automation-api -- ps aux | grep websockify