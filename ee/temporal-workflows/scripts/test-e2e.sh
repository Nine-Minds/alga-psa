#!/bin/bash

# E2E Test Runner Script
# This script sets up the complete testing environment and runs E2E tests

set -e

echo "🧪 Starting E2E Test Environment Setup..."

# Function to cleanup on exit
cleanup() {
    echo "🧹 Cleaning up test environment..."
    if [ ! -z "$TEMPORAL_PID" ]; then
        echo "  - Stopping Temporal dev server (PID: $TEMPORAL_PID)..."
        kill $TEMPORAL_PID 2>/dev/null || true
        wait $TEMPORAL_PID 2>/dev/null || true
    fi
    exit $1
}

# Trap cleanup on script exit
trap 'cleanup $?' EXIT

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

# Check if main application database is running
echo "📋 Checking main application database..."
if ! docker ps | grep -q "alga-psa-postgres-1"; then
    echo "❌ Main application database not running. Please start it first:"
    echo "   cd /Users/robertisaacs/alga-psa"
    echo "   docker-compose -f docker-compose.base.yaml up -d postgres"
    exit 1
fi

# Start Temporal dev server
echo "🚀 Starting Temporal dev server..."
temporal server start-dev --headless &
TEMPORAL_PID=$!

# Wait for Temporal server to be ready
echo "⏳ Waiting for Temporal server to be ready..."
counter=0
until temporal workflow list > /dev/null 2>&1; do
    if [ $counter -ge 30 ]; then
        echo "❌ Timeout waiting for Temporal server"
        exit 1
    fi
    sleep 2
    counter=$((counter + 1))
done

echo "✅ Temporal dev server is ready!"

# Set environment for E2E tests
export NODE_ENV=test
export TEMPORAL_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default

# Load E2E test environment
if [ -f .env.e2e ]; then
    echo "📝 Loading E2E test environment..."
    set -a
    source .env.e2e
    set +a
fi

# Run E2E tests
echo "🧪 Running E2E tests..."
if [ "$1" = "--watch" ]; then
    npm test -- src/__tests__/e2e --watch
else
    npm test -- src/__tests__/e2e
fi

echo "✅ E2E tests completed!"

# Cleanup is handled by trap