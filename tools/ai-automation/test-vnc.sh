#!/bin/bash

# Test VNC setup locally before deploying to Kubernetes

echo "=== Testing VNC Setup Locally ==="
echo "Building Docker image..."

cd /Users/robertisaacs/alga-psa/tools/ai-automation

# Build the image
docker build -t ai-automation-vnc-test .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed"
    exit 1
fi

echo "✅ Docker image built successfully"

# Run the container with VNC enabled
echo "Starting container with VNC enabled..."
docker run -d \
    --name vnc-test \
    -p 4000:4000 \
    -p 5900:5900 \
    -e VNC_ENABLED=true \
    -e NODE_ENV=development \
    ai-automation-vnc-test

if [ $? -ne 0 ]; then
    echo "❌ Failed to start container"
    exit 1
fi

echo "✅ Container started"
echo "Waiting for services to initialize..."
sleep 10

# Check container logs
echo ""
echo "=== Container Logs ==="
docker logs vnc-test

# Check if container is still running
if docker ps | grep -q vnc-test; then
    echo ""
    echo "✅ Container is running"
    
    # Check VNC processes inside container
    echo ""
    echo "=== Checking VNC Processes ==="
    docker exec vnc-test ps aux | grep -E "(Xvfb|x11vnc|websockify|fluxbox)" | grep -v grep
    
    # Check VNC logs
    echo ""
    echo "=== VNC Service Logs ==="
    echo "--- Xvfb Log ---"
    docker exec vnc-test cat /tmp/xvfb.log 2>/dev/null || echo "No Xvfb log found"
    echo ""
    echo "--- x11vnc Log ---"
    docker exec vnc-test cat /tmp/x11vnc.log 2>/dev/null || echo "No x11vnc log found"
    echo ""
    echo "--- websockify Log ---"
    docker exec vnc-test cat /tmp/websockify.log 2>/dev/null || echo "No websockify log found"
    
    # Test VNC connection
    echo ""
    echo "=== Testing VNC Connection ==="
    if command -v nc &> /dev/null; then
        if nc -zv localhost 5900 2>&1 | grep -q succeeded; then
            echo "✅ VNC port 5900 is accessible"
        else
            echo "❌ VNC port 5900 is not accessible"
        fi
    else
        echo "⚠️  netcat not installed, skipping port test"
    fi
    
    echo ""
    echo "=== Test Complete ==="
    echo "VNC should be accessible at: http://localhost:5900/vnc.html"
    echo "API should be accessible at: http://localhost:4000"
    echo ""
    echo "To view container logs in real-time: docker logs -f vnc-test"
    echo "To access container shell: docker exec -it vnc-test bash"
    echo "To stop and remove test container: docker stop vnc-test && docker rm vnc-test"
else
    echo ""
    echo "❌ Container stopped unexpectedly"
    echo "Last 50 lines of logs:"
    docker logs --tail 50 vnc-test
    docker rm vnc-test
    exit 1
fi