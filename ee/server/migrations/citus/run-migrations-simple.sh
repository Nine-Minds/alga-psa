#!/bin/bash

# Simple migration runner using psql directly
# This bypasses knex complexity for testing

set -e

echo "================================================"
echo "Simple Citus Migration Runner"
echo "================================================"

# Configuration
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5433}
DB_NAME=${DB_NAME:-server_test}
DB_USER=${DB_USER:-postgres}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run SQL via psql in docker
run_sql() {
    docker exec alga_citus_coordinator psql -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

# Function to run SQL file via psql
run_sql_file() {
    docker exec -i alga_citus_coordinator psql -U "$DB_USER" -d "$DB_NAME" < "$1"
}

# Check if Citus is running
check_citus() {
    echo -e "${YELLOW}Checking Citus status...${NC}"
    run_sql "SELECT citus_version();" || {
        echo -e "${RED}Citus is not running. Please start it first with:${NC}"
        echo "./ee/server/migrations/citus/test-migrations.sh start"
        exit 1
    }
}

# Run base migrations using knex (simplified)
run_base_migrations() {
    echo -e "${YELLOW}Running base migrations with knex...${NC}"
    
    cd server
    # Use the existing knexfile with environment variables
    PGHOST="$DB_HOST" \
    PGPORT="$DB_PORT" \
    PGUSER="$DB_USER" \
    PGPASSWORD="$POSTGRES_PASSWORD" \
    PGDATABASE="$DB_NAME" \
    DB_HOST="$DB_HOST" \
    DB_PORT="$DB_PORT" \
    DB_USER_ADMIN="$DB_USER" \
    DB_PASSWORD_ADMIN="$POSTGRES_PASSWORD" \
    DB_NAME_SERVER="$DB_NAME" \
    npx knex migrate:latest --env migration
    cd ..
    
    echo -e "${GREEN}Base migrations completed${NC}"
}

# Run Citus migrations directly
run_citus_migrations() {
    echo -e "${YELLOW}Running Citus migrations...${NC}"
    
    # Run each Citus migration file
    for migration in ee/server/migrations/citus/*.cjs; do
        if [[ -f "$migration" ]]; then
            filename=$(basename "$migration")
            
            # Skip non-migration files
            if [[ ! "$filename" =~ ^[0-9]{14}.*\.cjs$ ]]; then
                continue
            fi
            
            echo -e "${YELLOW}Running migration: $filename${NC}"
            
            # Convert the CommonJS to SQL and run it
            # For now, we'll manually check if Citus is enabled and skip if not
            node -e "
                const fs = require('fs');
                const migration = require('./$migration');
                
                // Mock knex object
                const knex = {
                    raw: async (sql, params) => {
                        // Output SQL for execution
                        if (params && params.length > 0) {
                            console.log('-- Parameters:', params);
                        }
                        console.log(sql + ';');
                        return { rows: [{enabled: true, available: true, distributed: false, exists: true}] };
                    }
                };
                
                // Run the up migration
                migration.up(knex).then(() => {
                    console.log('-- Migration complete');
                }).catch(err => {
                    console.error('-- Error:', err.message);
                    process.exit(1);
                });
            " | grep -v "^--" | docker exec -i alga_citus_coordinator psql -U "$DB_USER" -d "$DB_NAME"
            
            echo -e "${GREEN}  ✓ Completed: $filename${NC}"
        fi
    done
    
    echo -e "${GREEN}Citus migrations completed${NC}"
}

# Verify distribution
verify_distribution() {
    echo -e "${YELLOW}Verifying table distribution...${NC}"
    
    run_sql "
        SELECT 
            logicalrelid::regclass AS table_name,
            CASE 
                WHEN partmethod = 'h' THEN 'distributed'
                WHEN partmethod = 'n' THEN 'reference'
                ELSE partmethod
            END as type,
            column_to_column_name(logicalrelid, partkey) AS distribution_column,
            colocationid AS colocation_group
        FROM pg_dist_partition
        ORDER BY 
            CASE WHEN partmethod = 'n' THEN 1 ELSE 2 END,
            logicalrelid::regclass::text
        LIMIT 20;
    "
    
    echo -e "${YELLOW}Counting distributed tables...${NC}"
    run_sql "
        SELECT 
            COUNT(*) FILTER (WHERE partmethod = 'h') as distributed_tables,
            COUNT(*) FILTER (WHERE partmethod = 'n') as reference_tables,
            COUNT(DISTINCT colocationid) as colocation_groups
        FROM pg_dist_partition;
    "
}

# Main execution
case "${1:-}" in
    base)
        check_citus
        run_base_migrations
        ;;
    citus)
        check_citus
        run_citus_migrations
        ;;
    verify)
        check_citus
        verify_distribution
        ;;
    all)
        check_citus
        run_base_migrations
        run_citus_migrations
        verify_distribution
        echo -e "${GREEN}All migrations completed successfully!${NC}"
        ;;
    *)
        echo "Usage: $0 {base|citus|verify|all}"
        echo ""
        echo "Commands:"
        echo "  base   - Run base migrations only"
        echo "  citus  - Run Citus migrations only"
        echo "  verify - Verify table distribution"
        echo "  all    - Run all migrations and verify"
        echo ""
        echo "Note: Make sure Citus is running first with:"
        echo "  ./ee/server/migrations/citus/test-migrations.sh start"
        exit 1
        ;;
esac