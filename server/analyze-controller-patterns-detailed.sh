#!/bin/bash

# Script to analyze controller patterns used in API routes with detailed breakdown

echo "Detailed Analysis of Controller Patterns in API v1 Routes"
echo "========================================================"
echo ""

# Initialize counters
v2_count=0
standard_count=0
total_count=0

# Associative array to count controller types
declare -A v2_controllers
declare -A standard_controllers

# Function to extract controller name from import statement
extract_controller_name() {
    local import_line="$1"
    # Extract controller name from import statement
    echo "$import_line" | sed -E "s/.*import.*\{[[:space:]]*([^}]+)[[:space:]]*\}.*/\1/" | xargs
}

# Function to check controller pattern and extract details
check_controller_pattern() {
    local file="$1"
    local relative_path="${file#/home/coder/alga-psa/server/src/app/api/v1/}"
    
    # Get all controller imports from the file
    local imports=$(grep -E "import.*Controller" "$file" 2>/dev/null)
    
    if [ -n "$imports" ]; then
        while IFS= read -r import_line; do
            if [[ "$import_line" =~ "ControllerV2" ]]; then
                local controller_name=$(extract_controller_name "$import_line")
                ((v2_controllers[$controller_name]++))
                ((v2_count++))
                return 0
            else
                local controller_name=$(extract_controller_name "$import_line")
                ((standard_controllers[$controller_name]++))
                ((standard_count++))
                return 1
            fi
        done <<< "$imports"
    else
        ((standard_count++))
        return 1
    fi
}

# Process all route files
while IFS= read -r route_file; do
    ((total_count++))
    check_controller_pattern "$route_file"
done < <(find /home/coder/alga-psa/server/src/app/api/v1/ -name "route.ts" | sort)

# Output V2 Controllers
echo "=== V2 Controllers Usage ==="
echo "Controller Name                          | Count"
echo "----------------------------------------|------"
for controller in "${!v2_controllers[@]}"; do
    printf "%-40s | %4d\n" "$controller" "${v2_controllers[$controller]}"
done | sort

echo ""

# Output Standard Controllers
echo "=== Standard Controllers Usage ==="
echo "Controller Name                          | Count"
echo "----------------------------------------|------"
for controller in "${!standard_controllers[@]}"; do
    printf "%-40s | %4d\n" "$controller" "${standard_controllers[$controller]}"
done | sort

echo ""

# Group routes by resource
echo "=== V2 Controller Routes by Resource ==="
echo ""
find /home/coder/alga-psa/server/src/app/api/v1/ -name "route.ts" | while read -r route_file; do
    if grep -q "ControllerV2" "$route_file" 2>/dev/null; then
        echo "${route_file#/home/coder/alga-psa/server/src/app/api/v1/}"
    fi
done | awk -F'/' '{print $1}' | sort | uniq -c | sort -rn | while read count resource; do
    printf "%4d routes - %s\n" "$count" "$resource"
done

echo ""
echo "=== Summary ==="
echo "Total routes: ${total_count}"
echo "Using V2 Controllers: ${v2_count} routes"
echo "Using Standard Controllers: ${standard_count} routes"
echo "V2 Controller Types: ${#v2_controllers[@]}"
echo "Standard Controller Types: ${#standard_controllers[@]}"