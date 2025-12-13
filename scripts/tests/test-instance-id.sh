#!/bin/bash

echo "Testing Stable Instance ID Implementation"
echo "========================================"

# Test the instance ID endpoint
echo -e "\n1. Testing instance ID endpoint..."
curl -s http://localhost:3000/api/test-instance-id | jq '.' || echo "Failed to fetch instance ID"

# Test analytics endpoint
echo -e "\n2. Testing analytics capture..."
curl -s http://localhost:3000/api/test-all-analytics | jq '.test_results.user_login' || echo "Failed to test analytics"

echo -e "\nDone!"