#!/bin/bash

# Test Workflow Worker Health and Connectivity

set -e

echo "🔍 Testing Workflow Worker E2E Setup..."

# Function to test endpoint
test_endpoint() {
    local name=$1
    local url=$2
    local expected_pattern=$3
    
    echo -n "Testing $name... "
    if response=$(curl -s --max-time 10 "$url" 2>/dev/null); then
        if [[ -z "$expected_pattern" ]] || echo "$response" | grep -q "$expected_pattern"; then
            echo "✅"
            return 0
        else
            echo "❌ (unexpected response)"
            echo "Response: $response" | head -3
            return 1
        fi
    else
        echo "❌ (connection failed)"
        return 1
    fi
}

# Test infrastructure endpoints
echo ""
echo "📋 Testing Infrastructure:"
test_endpoint "PostgreSQL Test DB" "http://localhost:5433" "" || echo "  Note: Direct HTTP test not applicable for PostgreSQL"
test_endpoint "MailHog Web UI" "http://localhost:8025" "MailHog"
test_endpoint "WireMock Health" "http://localhost:8080/__admin/health" "healthy"

# Test workflow worker
echo ""
echo "📋 Testing Workflow Worker:"
test_endpoint "Worker Health Check" "http://localhost:4001/api/health/worker" "status"

# Test database connectivity from workflow worker
echo ""
echo "📋 Testing Database Connectivity:"
if docker exec sebastian_workflow_worker_test pg_isready -h postgres-test -p 5432 -U app_user -d server_test 2>/dev/null; then
    echo "Database connectivity: ✅"
else
    echo "Database connectivity: ❌"
fi

# Test Redis connectivity from workflow worker  
echo ""
echo "📋 Testing Redis Connectivity:"
if docker exec sebastian_workflow_worker_test redis-cli -h redis-test -p 6379 ping 2>/dev/null | grep -q "PONG"; then
    echo "Redis connectivity: ✅"
else
    echo "Redis connectivity: ❌ (may require auth)"
fi

echo ""
echo "📋 Container Status:"
docker ps --filter "name=sebastian" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "📊 Testing Complete!"