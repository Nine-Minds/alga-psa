#!/bin/bash

# Script to move v2 API routes to v1 (with force option for existing routes)
# This script will:
# 1. Find all route files under api/v2
# 2. Move them to v1, replacing existing files
# 3. Update path references

set -e

echo "Starting migration of v2 routes to v1..."

# Get all v2 route files
v2_routes=$(find ./src/app/api/v2 -name "route.ts" -type f | sort)

# Counter for statistics
moved=0
replaced=0
errors=0

for v2_route in $v2_routes; do
    # Extract the relative path from v2
    relative_path=${v2_route#./src/app/api/v2/}
    
    # Construct the v1 path
    v1_route="./src/app/api/v1/$relative_path"
    v1_dir=$(dirname "$v1_route")
    
    echo "Processing: $relative_path"
    
    # Create v1 directory if it doesn't exist
    if [ ! -d "$v1_dir" ]; then
        echo "  Creating directory: $v1_dir"
        mkdir -p "$v1_dir"
    fi
    
    # Check if v1 route already exists
    if [ -f "$v1_route" ]; then
        echo "  Replacing existing v1 route"
        ((replaced++))
    else
        echo "  Moving to new location"
        ((moved++))
    fi
    
    # Copy the file (preserving the original for now)
    cp "$v2_route" "$v1_route"
    
    # Update the path comment in the file
    sed -i "s|/api/v2/|/api/v1/|g" "$v1_route"
    
    echo ""
done

echo "Migration complete!"
echo "  New routes moved: $moved"
echo "  Existing routes replaced: $replaced"
echo "  Errors: $errors"

# Now remove the v2 directory
echo ""
echo "Removing v2 directory..."
rm -rf ./src/app/api/v2

echo "v2 directory removed successfully!"