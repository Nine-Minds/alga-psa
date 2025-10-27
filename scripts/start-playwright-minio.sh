#!/bin/bash

# Start MinIO for Playwright tests
# Run this script before running Playwright tests from the IDE

echo "🗄️  Starting test MinIO container on port 9002..."

cd "$(dirname "$0")/.." || exit 1

# Start MinIO container
docker compose -f docker-compose.playwright.yml up -d

# Wait for MinIO to be ready
echo "⏳ Waiting for MinIO to be ready..."
sleep 3

# Create test bucket
echo "📦 Creating test bucket 'alga-test'..."
docker exec alga-psa-minio-test mc alias set local http://localhost:9000 minioadmin minioadmin && \
docker exec alga-psa-minio-test mc mb local/alga-test --ignore-existing

echo "✅ MinIO test container ready on port 9002"
echo "   - Endpoint: http://localhost:9002"
echo "   - Console: http://localhost:9003"
echo "   - Bucket: alga-test"
echo ""
echo "You can now run Playwright tests from the IDE."
