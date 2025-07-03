#!/bin/bash

echo "=== Analytics Test Script ==="
echo "Testing all implemented analytics events..."
echo

# Set environment variables for testing
export ALGA_USAGE_STATS=true
export NEXT_PUBLIC_ALGA_USAGE_STATS=true

# Get the auth token if available
AUTH_TOKEN=$(cat ~/.alga-auth-token 2>/dev/null || echo "")

if [ -z "$AUTH_TOKEN" ]; then
    echo "No auth token found. Please log in first."
    echo "You can test manually by visiting: http://localhost:3000/analytics-test"
    exit 1
fi

# Test the analytics endpoint
echo "1. Testing analytics endpoint..."
curl -s -X GET http://localhost:3000/api/test-all-analytics \
     -H "Cookie: $AUTH_TOKEN" \
     -H "Content-Type: application/json" | jq .

echo
echo "2. To view the test UI, visit: http://localhost:3000/analytics-test"
echo "   Navigate to: Settings > Analytics Test"
echo
echo "3. To monitor events in PostHog:"
echo "   - Visit: https://us.posthog.com"
echo "   - Project ID: phc_pF8AKuHHjdsCDHAtcYurplhk2aE5A5HNNqlcma6hUmB"
echo "   - Look for events with test_run: true property"
echo
echo "=== Test Complete ==="