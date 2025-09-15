#!/bin/bash

echo "Testing Next.js WITHOUT Express..."
echo "================================="

# Start the dev server in background
echo "Starting Next.js dev server..."
npm run dev &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 10

# Test health endpoint
echo -e "\n1. Testing /api/healthz endpoint:"
curl -s http://localhost:3000/api/healthz | jq '.'

# Check if Express is in the process
echo -e "\n2. Checking for Express in running processes:"
if ps aux | grep -v grep | grep "tsx index.ts"; then
  echo "❌ WARNING: Express server is running!"
else
  echo "✅ Good: No Express server detected"
fi

# Check Next.js is running
if ps aux | grep -v grep | grep "next dev"; then
  echo "✅ Good: Next.js dev server is running"
else
  echo "❌ WARNING: Next.js dev server not found"
fi

# Kill the server
echo -e "\n3. Stopping server..."
kill $SERVER_PID 2>/dev/null

echo -e "\nTest complete!"