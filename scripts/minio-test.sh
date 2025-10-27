#!/bin/bash
# Helper script to manage test MinIO instance

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

case "${1:-}" in
  start)
    echo "🗄️  Starting test MinIO on port 9002..."
    docker compose -f "$PROJECT_ROOT/docker-compose.playwright.yml" up -d

    echo "⏳ Waiting for MinIO to be ready..."
    sleep 3

    echo "📦 Creating test bucket..."
    docker exec alga-psa-minio-test mc alias set local http://localhost:9000 minioadmin minioadmin
    docker exec alga-psa-minio-test mc mb local/alga-test --ignore-existing

    echo "✅ Test MinIO ready!"
    echo "   - API: http://localhost:9002"
    echo "   - Console: http://localhost:9003"
    echo "   - Credentials: minioadmin / minioadmin"
    echo "   - Bucket: alga-test"
    ;;

  stop)
    echo "🛑 Stopping test MinIO..."
    docker compose -f "$PROJECT_ROOT/docker-compose.playwright.yml" down -v
    echo "✅ Test MinIO stopped and cleaned up"
    ;;

  restart)
    "$0" stop
    "$0" start
    ;;

  status)
    echo "📊 Test MinIO status:"
    docker compose -f "$PROJECT_ROOT/docker-compose.playwright.yml" ps
    ;;

  logs)
    docker compose -f "$PROJECT_ROOT/docker-compose.playwright.yml" logs -f
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "Commands:"
    echo "  start    - Start test MinIO container on port 9002"
    echo "  stop     - Stop and remove test MinIO container"
    echo "  restart  - Restart test MinIO"
    echo "  status   - Show container status"
    echo "  logs     - Show container logs"
    echo ""
    echo "Note: This is separate from your Payload MinIO on port 9000"
    exit 1
    ;;
esac
