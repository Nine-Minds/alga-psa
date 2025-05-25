#!/bin/bash

# Script to run the QuickAddCompany UI state test
# Usage: ./run-test.sh [BASE_URL]

BASE_URL=${1:-""}

# Try common development URLs if none specified
if [ -z "$BASE_URL" ]; then
    echo "🔍 Auto-detecting development server..."
    
    POSSIBLE_URLS=(
        "http://localhost:3000"
        "http://localhost:3001" 
        "http://localhost:8080"
        "http://127.0.0.1:3000"
        "http://0.0.0.0:3000"
    )
    
    for url in "${POSSIBLE_URLS[@]}"; do
        echo "   Trying $url..."
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
        if [[ "$HTTP_CODE" =~ ^(200|302|307)$ ]]; then
            BASE_URL="$url"
            echo "   ✅ Found server at $url (HTTP $HTTP_CODE)"
            break
        fi
    done
    
    if [ -z "$BASE_URL" ]; then
        echo "❌ ERROR: Could not find development server on common ports"
        echo "   Tried: ${POSSIBLE_URLS[*]}"
        echo "   Please specify URL manually: ./run-test.sh http://your-server:port"
        exit 1
    fi
else
    echo "🧪 Running QuickAddCompany UI State Test..."
    echo "📍 Target URL: $BASE_URL"
    echo ""

    # Check if the specified URL is accessible (allow redirects)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL")
    if [[ ! "$HTTP_CODE" =~ ^(200|302|307)$ ]]; then
        echo "❌ ERROR: Cannot reach $BASE_URL (HTTP $HTTP_CODE)"
        echo "   Make sure your development server is running"
        exit 1
    fi
fi

echo "✅ Server is accessible"
echo ""

# Run the test
cd /Users/robertisaacs/alga-psa/tools/ai-automation
BASE_URL="$BASE_URL" NODE_NO_WARNINGS=1 node --experimental-specifier-resolution=node --loader ts-node/esm test-quick-add-company-ui-state.ts