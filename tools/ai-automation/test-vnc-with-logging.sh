#!/bin/bash

echo "Testing VNC setup with detailed logging..."

# Create a deployment that logs the npm run dev output
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: debug-startup
  namespace: vnc-final-test
data:
  debug-startup.sh: |
    #!/bin/bash
    set -e
    
    echo "=== Debug Startup Script ==="
    echo "Working directory: \$(pwd)"
    echo "Node version: \$(node --version)"
    echo "NPM version: \$(npm --version)"
    echo ""
    echo "=== Package.json contents ==="
    cat package.json
    echo ""
    echo "=== Starting npm run dev ==="
    npm run dev 2>&1 || {
      echo "npm run dev failed with exit code: \$?"
      echo "=== Error output above ==="
      # Keep container running for debugging
      sleep 3600
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-vnc-debug
  namespace: vnc-final-test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ai-vnc-debug
  template:
    metadata:
      labels:
        app: ai-vnc-debug
    spec:
      containers:
      - name: ai-automation
        image: harbor.nineminds.com/library/ai-automation:vnc-final-test-amd64
        imagePullPolicy: Always
        command: ["/bin/bash", "/debug/debug-startup.sh"]
        env:
        - name: VNC_ENABLED
          value: "false"  # Disable VNC to focus on app startup
        - name: NODE_ENV
          value: "development"
        - name: DISPLAY
          value: ":99"
        - name: PORT
          value: "4000"
        ports:
        - containerPort: 4000
          name: api
        volumeMounts:
        - name: debug
          mountPath: /debug
        securityContext:
          runAsUser: 1000
          runAsGroup: 1000
      imagePullSecrets:
      - name: harbor-credentials
      volumes:
      - name: debug
        configMap:
          name: debug-startup
          defaultMode: 0755
EOF

echo "Deployment created. Waiting for logs..."
sleep 10
kubectl logs -n vnc-final-test -l app=ai-vnc-debug -f