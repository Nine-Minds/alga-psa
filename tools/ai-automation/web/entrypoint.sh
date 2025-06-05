#!/bin/sh
# This script ensures the proxy server starts instead of the standalone server

# Check if http-proxy-middleware is installed
if [ ! -d "node_modules/http-proxy-middleware" ]; then
  echo "Installing http-proxy-middleware..."
  npm install http-proxy-middleware
fi

# Start the proxy server
exec node proxy-server.js