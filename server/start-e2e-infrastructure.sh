#!/bin/bash

# E2E Infrastructure Startup Script
# This script starts the basic E2E testing infrastructure

set -e

echo "🚀 Starting E2E Testing Infrastructure..."

# Check if we're in the right directory
if [ ! -f "docker-compose.e2e-simple.yaml" ]; then
    echo "❌ Please run this script from the alga-psa root directory"
    exit 1
fi

# Check if secrets exist
if [ ! -d "secrets" ]; then
    echo "❌ Secrets directory not found. Please run setup first."
    exit 1
fi

# Load environment from server/.env if it exists
if [ -f "server/.env" ]; then
    echo "📋 Loading environment from server/.env"
    export $(cat server/.env | grep -v '^#' | xargs)
fi

# Set default APP_NAME if not set
export APP_NAME=${APP_NAME:-sebastian}

echo "📋 Configuration:"
echo "  APP_NAME: $APP_NAME"

echo ""
echo "🛑 Stopping any existing E2E containers..."
docker-compose -f docker-compose.e2e-simple.yaml down --remove-orphans 2>/dev/null || true

echo ""
echo "🏗️  Starting E2E infrastructure services..."
docker-compose -f docker-compose.e2e-simple.yaml up -d

echo ""
echo "⏳ Waiting for services to be healthy..."

# Function to check service health
check_service_health() {
    local service_name=$1
    local max_attempts=$2
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker-compose -f docker-compose.e2e-simple.yaml ps $service_name | grep -q "healthy"; then
            echo "✅ $service_name is healthy"
            return 0
        fi
        echo "⏳ Waiting for $service_name to be healthy (attempt $attempt/$max_attempts)..."
        sleep 10
        ((attempt++))
    done
    
    echo "❌ $service_name failed to become healthy"
    return 1
}

# Check core services
check_service_health "postgres-test" 12
check_service_health "redis-test" 6
check_service_health "mailhog" 6
check_service_health "webhook-mock" 6

echo ""
echo "🔍 Service Status:"
docker-compose -f docker-compose.e2e-simple.yaml ps

echo ""
echo "🌐 E2E Infrastructure Endpoints:"
echo "  🐘 PostgreSQL Test DB: localhost:5433"
echo "  🔴 Redis Test: localhost:6380"  
echo "  📧 MailHog SMTP: localhost:1025"
echo "  📧 MailHog Web UI: http://localhost:8025"
echo "  🔧 WireMock: http://localhost:8080"
echo "  🔧 WireMock Admin: http://localhost:8080/__admin"

echo ""
echo "✅ E2E Infrastructure is ready!"
echo ""
echo "💡 Next steps:"
echo "  - Add main server and workflow worker to the setup"
echo "  - Configure test environment variables"
echo "  - Run e2e tests"
echo ""
echo "🛑 To stop infrastructure:"
echo "  docker-compose -f docker-compose.e2e-simple.yaml down"