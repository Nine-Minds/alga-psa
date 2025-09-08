#!/bin/bash

# Script to analyze Citus migration errors from Argo Workflow logs

set -e

echo "=== Citus Migration Error Analysis Tool ==="
echo ""

# Function to get the latest workflow run
get_latest_workflow() {
    kubectl get workflows -n argo | grep citus-migration-test | head -1 | awk '{print $1}'
}

# Function to extract migration logs
get_migration_logs() {
    local workflow_name=$1
    
    echo "Fetching logs from workflow: $workflow_name"
    echo "-------------------------------------------"
    
    # Find the migration execution pod
    local migration_pod=$(kubectl get pods -n argo | grep "$workflow_name" | grep -E "(run-all-migrations|execute-combined-migrations)" | awk '{print $1}' | head -1)
    
    if [ -z "$migration_pod" ]; then
        echo "ERROR: Could not find migration pod for workflow $workflow_name"
        return 1
    fi
    
    echo "Found migration pod: $migration_pod"
    echo ""
    
    # Get the logs
    kubectl logs "$migration_pod" -n argo -c main 2>/dev/null || {
        echo "ERROR: Could not fetch logs from pod $migration_pod"
        return 1
    }
}

# Function to parse errors from logs
parse_migration_errors() {
    local log_file=$1
    
    echo "=== Parsing Migration Errors ==="
    echo ""
    
    # Extract reference table errors
    echo "Reference Table Errors:"
    grep -E "Failed to create reference table" "$log_file" | while read -r line; do
        table=$(echo "$line" | sed -n 's/.*Failed to create reference table \([^:]*\):.*/\1/p')
        error=$(echo "$line" | sed -n 's/.*: \(.*\)/\1/p')
        echo "  - Table: $table"
        echo "    Error: $error"
        echo ""
    done
    
    # Extract distributed table errors
    echo "Distributed Table Errors:"
    grep -E "Failed to distribute table" "$log_file" | while read -r line; do
        table=$(echo "$line" | sed -n 's/.*Failed to distribute table \([^:]*\):.*/\1/p')
        error=$(echo "$line" | sed -n 's/.*: \(.*\)/\1/p')
        echo "  - Table: $table"
        echo "    Error: $error"
        echo ""
    done
    
    # Extract foreign key dependency errors
    echo "Foreign Key Dependency Issues:"
    grep -E "referenced table.*must be a distributed table or a reference table" "$log_file" | while read -r line; do
        echo "  - $line"
    done
    
    # Extract transaction errors
    echo ""
    echo "Transaction Errors:"
    grep -E "current transaction is aborted" "$log_file" | head -3 | while read -r line; do
        echo "  - Transaction aborted (subsequent commands will fail)"
        break
    done
}

# Function to analyze foreign key dependencies
analyze_dependencies() {
    echo ""
    echo "=== Analyzing Table Dependencies ==="
    echo ""
    
    # Create a temporary SQL script to analyze dependencies
    cat > /tmp/analyze_deps.sql << 'EOF'
SELECT 
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;
EOF
    
    echo "To analyze dependencies in the database, run:"
    echo "kubectl exec -n argo citus-coordinator-0 -- psql -U postgres -d server_test -f /tmp/analyze_deps.sql"
}

# Function to generate fix recommendations
generate_recommendations() {
    local log_file=$1
    
    echo ""
    echo "=== Recommendations ==="
    echo ""
    
    # Check for foreign key issues
    if grep -q "referenced table.*must be a distributed table or a reference table" "$log_file"; then
        echo "1. Foreign Key Dependency Issues Detected:"
        echo "   - Tables with foreign keys must be distributed AFTER their referenced tables"
        echo "   - Consider reordering migrations or combining them"
        echo ""
        
        # Extract specific dependency issues
        grep -E "referenced table \"([^\"]+)\"" "$log_file" | sed -n 's/.*referenced table "\([^"]*\)".*/\1/p' | sort -u | while read -r ref_table; do
            echo "   - Table '$ref_table' needs to be distributed first"
        done
    fi
    
    # Check for transaction issues
    if grep -q "current transaction is aborted" "$log_file"; then
        echo ""
        echo "2. Transaction Management Issues:"
        echo "   - Migrations are failing within a transaction, causing cascade failures"
        echo "   - Consider:"
        echo "     a) Running each table distribution in a separate transaction"
        echo "     b) Adding proper error recovery"
        echo "     c) Checking dependencies before attempting distribution"
    fi
    
    # Check for missing tables
    if grep -q "does not exist" "$log_file"; then
        echo ""
        echo "3. Missing Tables:"
        echo "   - Some tables don't exist in the database"
        echo "   - Ensure base schema migrations run before Citus migrations"
    fi
}

# Main execution
main() {
    # Get workflow name from argument or find latest
    WORKFLOW_NAME=${1:-$(get_latest_workflow)}
    
    if [ -z "$WORKFLOW_NAME" ]; then
        echo "ERROR: No Citus migration workflow found"
        echo "Usage: $0 [workflow-name]"
        exit 1
    fi
    
    # Create temporary log file
    LOG_FILE="/tmp/citus_migration_logs_$(date +%s).log"
    
    # Get the logs
    get_migration_logs "$WORKFLOW_NAME" > "$LOG_FILE" 2>&1
    
    # Parse errors
    parse_migration_errors "$LOG_FILE"
    
    # Analyze dependencies
    analyze_dependencies
    
    # Generate recommendations
    generate_recommendations "$LOG_FILE"
    
    echo ""
    echo "Full logs saved to: $LOG_FILE"
    echo ""
    echo "To view full migration logs:"
    echo "kubectl logs \$(kubectl get pods -n argo | grep $WORKFLOW_NAME | grep -E '(run-all-migrations|execute-combined-migrations)' | awk '{print \$1}') -n argo -c main"
}

# Run main function
main "$@"