#!/bin/bash

# Stop MinIO for Playwright tests

echo "🛑 Stopping test MinIO container..."

cd "$(dirname "$0")/.." || exit 1

docker compose -f docker-compose.playwright.yml down

echo "✅ MinIO test container stopped"
