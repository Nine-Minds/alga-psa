#!/bin/bash

# Script to analyze controller patterns used in API routes

echo "Analyzing controller patterns in API v1 routes..."
echo "============================================="
echo ""

# Initialize counters
v2_count=0
standard_count=0
total_count=0

# Arrays to store categorized routes
declare -a v2_routes=()
declare -a standard_routes=()

# Function to check if a file uses V2 controller
check_controller_pattern() {
    local file="$1"
    local relative_path="${file#/home/coder/alga-psa/server/src/app/api/v1/}"
    
    # Check for V2Controller import
    if grep -q "V2Controller" "$file" 2>/dev/null; then
        v2_routes+=("$relative_path")
        ((v2_count++))
        return 0
    else
        standard_routes+=("$relative_path")
        ((standard_count++))
        return 1
    fi
}

# Process all route files
while IFS= read -r route_file; do
    ((total_count++))
    check_controller_pattern "$route_file"
done < <(find /home/coder/alga-psa/server/src/app/api/v1/ -name "route.ts" | sort)

# Output results
echo "=== V2 Controller Routes (${v2_count}) ==="
printf '%s\n' "${v2_routes[@]}" | sort
echo ""

echo "=== Standard Controller Routes (${standard_count}) ==="
printf '%s\n' "${standard_routes[@]}" | sort
echo ""

echo "=== Summary ==="
echo "Total routes: ${total_count}"
echo "V2 Controller: ${v2_count} ($(( v2_count * 100 / total_count ))%)"
echo "Standard Controller: ${standard_count} ($(( standard_count * 100 / total_count ))%)"