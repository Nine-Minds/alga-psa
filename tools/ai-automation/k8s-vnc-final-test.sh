#!/bin/bash

echo "=== Building and testing VNC setup for Kubernetes ==="

# Build the image
echo "Building Docker image..."
docker build -t ai-automation-vnc-final:test .

# Create a test deployment
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: test-app
  namespace: vnc-test
data:
  package.json: |
    {
      "name": "test-app",
      "version": "1.0.0",
      "scripts": {
        "dev": "echo 'Application running successfully!' && sleep infinity"
      }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vnc-final-test
  namespace: vnc-test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vnc-final-test
  template:
    metadata:
      labels:
        app: vnc-final-test
    spec:
      containers:
      - name: ai-automation
        image: ai-automation-vnc-final:test
        imagePullPolicy: Never
        env:
        - name: VNC_ENABLED
          value: "true"
        ports:
        - containerPort: 4000
          name: api
        - containerPort: 5900
          name: vnc
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1"
        volumeMounts:
        - name: shm
          mountPath: /dev/shm
        - name: app
          mountPath: /usr/src/app/package.json
          subPath: package.json
      volumes:
      - name: shm
        emptyDir:
          medium: Memory
          sizeLimit: 256Mi
      - name: app
        configMap:
          name: test-app
EOF

echo "Deployment created. Waiting for pod to start..."
sleep 10

# Check logs
echo ""
echo "=== Pod Logs ==="
kubectl logs -n vnc-test deployment/vnc-final-test --tail=50

echo ""
echo "=== Pod Status ==="
kubectl get pods -n vnc-test -l app=vnc-final-test