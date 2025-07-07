#!/bin/bash

# Script to move v2 API routes to v1
# This script will:
# 1. Find all route files under api/v2
# 2. Check if corresponding directory exists in v1
# 3. Move or merge the routes

set -e

echo "Starting migration of v2 routes to v1..."

# Get all v2 route files
v2_routes=$(find ./src/app/api/v2 -name "route.ts" -type f | sort)

# Counter for statistics
moved=0
skipped=0
errors=0

for v2_route in $v2_routes; do
    # Extract the relative path from v2
    relative_path=${v2_route#./src/app/api/v2/}
    
    # Construct the v1 path
    v1_route="./src/app/api/v1/$relative_path"
    v1_dir=$(dirname "$v1_route")
    
    echo "Processing: $relative_path"
    
    # Check if v1 route already exists
    if [ -f "$v1_route" ]; then
        echo "  ⚠️  Route already exists in v1: $v1_route"
        echo "  Comparing files..."
        
        # Compare the files (ignoring comments and whitespace)
        if diff -q -w -I '^[[:space:]]*\*' -I '^[[:space:]]*\/\/' "$v2_route" "$v1_route" > /dev/null; then
            echo "  ✓ Files are identical (ignoring comments), safe to remove v2 version"
            rm "$v2_route"
            ((moved++))
        else
            echo "  ⚠️  Files differ, skipping (manual review needed)"
            echo "     v2: $v2_route"
            echo "     v1: $v1_route"
            ((skipped++))
        fi
    else
        # Create v1 directory if it doesn't exist
        if [ ! -d "$v1_dir" ]; then
            echo "  Creating directory: $v1_dir"
            mkdir -p "$v1_dir"
        fi
        
        # Move the file
        echo "  Moving to: $v1_route"
        mv "$v2_route" "$v1_route"
        
        # Update the path comment in the file
        sed -i "s|/api/v2/|/api/v1/|g" "$v1_route"
        
        ((moved++))
    fi
    
    echo ""
done

# Clean up empty directories in v2
echo "Cleaning up empty directories in v2..."
find ./src/app/api/v2 -type d -empty -delete 2>/dev/null || true

echo "Migration complete!"
echo "  Moved: $moved"
echo "  Skipped: $skipped"
echo "  Errors: $errors"

# List remaining v2 routes (if any)
remaining=$(find ./src/app/api/v2 -name "route.ts" -type f 2>/dev/null | wc -l)
if [ "$remaining" -gt 0 ]; then
    echo ""
    echo "⚠️  Warning: $remaining routes still remain in v2 (require manual review):"
    find ./src/app/api/v2 -name "route.ts" -type f
fi