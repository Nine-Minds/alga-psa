#!/bin/bash

# E2E Test Setup Validation Script

set -e

echo "🚀 Starting E2E Test Environment Setup Validation..."

# Load test environment
export $(cat .env.e2e | grep -v '^#' | xargs)

echo "📋 Environment Variables:"
echo "  APP_NAME: $APP_NAME"
echo "  APP_ENV: $APP_ENV"
echo "  NODE_ENV: $NODE_ENV"
echo "  LOG_LEVEL: $LOG_LEVEL"

echo ""
echo "🔧 Checking prerequisites..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi
echo "✅ Docker is running"

# Check if required files exist
REQUIRED_FILES=(
    "docker-compose.e2e.yaml"
    "test-config/wiremock/mappings/microsoft-webhook.json"
    "test-config/wiremock/mappings/google-webhook.json"
    ".env.e2e"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Required file missing: $file"
        exit 1
    fi
    echo "✅ Found: $file"
done

echo ""
echo "🏗️  Building and starting E2E services..."

# Start E2E environment
docker-compose -f docker-compose.e2e.yaml up -d --build

echo ""
echo "⏳ Waiting for services to be healthy..."

# Function to check service health
check_service_health() {
    local service_name=$1
    local max_attempts=$2
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker-compose -f docker-compose.e2e.yaml ps $service_name | grep -q "healthy"; then
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

echo ""
echo "🔍 Service Status Check:"
docker-compose -f docker-compose.e2e.yaml ps

echo ""
echo "🌐 Service Endpoints:"
echo "  🐘 PostgreSQL Test DB: localhost:5433"
echo "  🔴 Redis Test: localhost:6380"  
echo "  🚀 Server Test: http://localhost:3001"
echo "  📧 MailHog Web UI: http://localhost:8025"
echo "  🔧 WireMock Admin: http://localhost:8080/__admin"
echo "  ⚙️  Workflow Worker Health: http://localhost:4001/api/health/worker"

echo ""
echo "✅ E2E Test Environment Setup Complete!"
echo ""
echo "🧪 To run tests:"
echo "  docker-compose -f docker-compose.e2e.yaml logs -f"
echo ""
echo "🛑 To stop environment:"
echo "  docker-compose -f docker-compose.e2e.yaml down"