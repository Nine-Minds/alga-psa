#!/bin/bash

# Test script for Citus migrations
# This script sets up a local Citus cluster and runs migrations to verify they work correctly

set -e

echo "================================================"
echo "Citus Migration Test Script"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5433}
DB_NAME=${DB_NAME:-server_test}
DB_USER=${DB_USER:-postgres}

# Function to check if docker compose is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}Docker is not running. Please start Docker first.${NC}"
        exit 1
    fi
}

# Function to start Citus cluster
start_citus() {
    echo -e "${YELLOW}Starting Citus cluster...${NC}"
    docker compose -f docker-compose.test-citus.yaml up -d
    
    echo "Waiting for Citus to be ready..."
    sleep 15
    
    # Verify Citus is running
    docker exec alga_citus_coordinator psql -U postgres -d server_test -c "SELECT citus_version();" || {
        echo -e "${RED}Failed to connect to Citus${NC}"
        exit 1
    }
    
    echo -e "${GREEN}Citus cluster started successfully${NC}"
}

# Function to stop Citus cluster
stop_citus() {
    echo -e "${YELLOW}Stopping Citus cluster...${NC}"
    docker compose -f docker-compose.test-citus.yaml down -v
}

# Function to run base migrations
run_base_migrations() {
    echo -e "${YELLOW}Running base migrations...${NC}"
    
    # Create a temporary directory for combined migrations
    TEMP_DIR=$(mktemp -d)
    echo "Using temporary directory: $TEMP_DIR"
    
    # Copy base migrations
    cp server/migrations/*.cjs "$TEMP_DIR/" 2>/dev/null || true
    
    # Create temporary knexfile for testing
    cat > "$TEMP_DIR/knexfile-test.cjs" << EOF
module.exports = {
  test_citus: {
    client: 'pg',
    connection: {
      host: '$DB_HOST',
      port: $DB_PORT,
      user: '$DB_USER',
      password: '$POSTGRES_PASSWORD',
      database: '$DB_NAME',
    },
    pool: {
      min: 0,
      max: 20,
    },
    migrations: {
      directory: "$TEMP_DIR"
    }
  }
};
EOF
    
    # Run migrations using npx from project root
    npx knex migrate:latest \
        --knexfile "$TEMP_DIR/knexfile-test.cjs" \
        --env test_citus
    
    # Clean up
    rm -rf "$TEMP_DIR"
    
    echo -e "${GREEN}Base migrations completed${NC}"
}

# Function to run Citus migrations
run_citus_migrations() {
    echo -e "${YELLOW}Running Citus migrations...${NC}"
    
    # Create a temporary directory for Citus migrations
    TEMP_DIR=$(mktemp -d)
    echo "Using temporary directory: $TEMP_DIR"
    
    # Copy Citus migrations
    cp ee/server/migrations/citus/*.cjs "$TEMP_DIR/" 2>/dev/null || true
    
    # Create temporary knexfile for testing
    cat > "$TEMP_DIR/knexfile-test.cjs" << EOF
module.exports = {
  test_citus: {
    client: 'pg',
    connection: {
      host: '$DB_HOST',
      port: $DB_PORT,
      user: '$DB_USER',
      password: '$POSTGRES_PASSWORD',
      database: '$DB_NAME',
    },
    pool: {
      min: 0,
      max: 20,
    },
    migrations: {
      directory: "$TEMP_DIR"
    }
  }
};
EOF
    
    # Run migrations using npx from project root
    npx knex migrate:latest \
        --knexfile "$TEMP_DIR/knexfile-test.cjs" \
        --env test_citus
    
    # Clean up
    rm -rf "$TEMP_DIR"
    
    echo -e "${GREEN}Citus migrations completed${NC}"
}

# Function to verify distribution
verify_distribution() {
    echo -e "${YELLOW}Verifying table distribution...${NC}"
    
    docker exec alga_citus_coordinator psql -U postgres -d server_test -c "
        SELECT 
            logicalrelid::regclass AS table_name,
            column_to_column_name(logicalrelid, partkey) AS distribution_column,
            colocationid AS colocation_group,
            partmethod AS method
        FROM pg_dist_partition
        ORDER BY logicalrelid::regclass::text
        LIMIT 10;
    "
    
    echo -e "${YELLOW}Checking worker nodes...${NC}"
    docker exec alga_citus_coordinator psql -U postgres -d server_test -c "
        SELECT * FROM citus_get_active_worker_nodes();
    "
    
    echo -e "${YELLOW}Counting distributed tables...${NC}"
    docker exec alga_citus_coordinator psql -U postgres -d server_test -c "
        SELECT 
            COUNT(*) as distributed_tables,
            COUNT(DISTINCT colocationid) as colocation_groups
        FROM pg_dist_partition;
    "
}

# Main execution
main() {
    case "${1:-}" in
        start)
            check_docker
            start_citus
            ;;
        stop)
            stop_citus
            ;;
        migrate)
            check_docker
            run_base_migrations
            run_citus_migrations
            verify_distribution
            ;;
        verify)
            verify_distribution
            ;;
        full)
            check_docker
            stop_citus
            start_citus
            run_base_migrations
            run_citus_migrations
            verify_distribution
            echo -e "${GREEN}Full test completed successfully!${NC}"
            ;;
        clean)
            stop_citus
            echo -e "${GREEN}Cleanup completed${NC}"
            ;;
        *)
            echo "Usage: $0 {start|stop|migrate|verify|full|clean}"
            echo ""
            echo "Commands:"
            echo "  start   - Start Citus cluster"
            echo "  stop    - Stop Citus cluster"
            echo "  migrate - Run base and Citus migrations"
            echo "  verify  - Verify table distribution"
            echo "  full    - Run full test (start, migrate, verify)"
            echo "  clean   - Stop and remove all containers/volumes"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"