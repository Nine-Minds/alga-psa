#!/bin/bash

# E2E Test Runner Script
# This script sets up the complete testing environment and runs E2E tests

set -e

echo "🧪 Starting E2E Test Environment Setup..."

# Function to cleanup on exit
cleanup() {
    echo "🧹 Cleaning up test environment..."
    docker-compose -f docker-compose.test.yml down --volumes --remove-orphans || true
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

# Pull latest images
echo "📦 Pulling latest Docker images..."
docker-compose -f docker-compose.test.yml pull

# Start test environment
echo "🚀 Starting Temporal test environment..."
docker-compose -f docker-compose.test.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."

# Wait for Temporal postgres
echo "  - Waiting for Temporal PostgreSQL..."
timeout 60 bash -c 'until docker-compose -f docker-compose.test.yml exec postgres pg_isready -U temporal; do sleep 2; done'

# Wait for Temporal server
echo "  - Waiting for Temporal server..."
timeout 120 bash -c 'until docker-compose -f docker-compose.test.yml exec temporal tctl workflow list > /dev/null 2>&1; do sleep 2; done'

echo "✅ All services are ready!"

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