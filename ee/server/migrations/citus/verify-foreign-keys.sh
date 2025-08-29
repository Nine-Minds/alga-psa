#!/bin/bash

# Script to verify foreign keys after Citus migrations
# Can be run locally or in CI/CD pipelines

set -e

echo "==================================================="
echo "   Citus Foreign Key Verification"
echo "==================================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "Error: This script must be run from the project root directory"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Run the verification script
echo "Running foreign key verification..."
echo ""

node ee/server/migrations/citus/verify-foreign-keys.js

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Foreign key verification passed!"
else
    echo ""
    echo "❌ Foreign key verification failed - missing foreign keys detected"
    echo "Please review the output above and recreate missing foreign keys"
fi

exit $EXIT_CODE