#!/bin/bash

# Script to run the QuickAddCompany UI state test with authentication
# Usage: ./run-auth-test.sh [EMAIL] [PASSWORD] [BASE_URL]

DEFAULT_EMAIL="robert@emeraldcity.oz"
DEFAULT_PASSWORD="555"
DEFAULT_URL="http://localhost:3000"

TEST_EMAIL=${1:-$DEFAULT_EMAIL}
TEST_PASSWORD=${2:-$DEFAULT_PASSWORD}
BASE_URL=${3:-$DEFAULT_URL}

echo "🧪 Running QuickAddCompany UI State Test with Authentication..."
echo "📧 Email: $TEST_EMAIL"
echo "🔐 Password: [hidden]"
echo "📍 URL: $BASE_URL"
echo ""

# Check if server is accessible
echo "🔍 Checking server accessibility..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL" 2>/dev/null || echo "000")
if [[ ! "$HTTP_CODE" =~ ^(200|302|307)$ ]]; then
    echo "❌ ERROR: Cannot reach $BASE_URL (HTTP $HTTP_CODE)"
    echo "   Make sure your development server is running"
    exit 1
fi

echo "✅ Server is accessible (HTTP $HTTP_CODE)"
echo ""

# Run the test
cd /Users/robertisaacs/alga-psa/tools/ai-automation

echo "🚀 Starting browser test..."
TEST_EMAIL="$TEST_EMAIL" \
TEST_PASSWORD="$TEST_PASSWORD" \
BASE_URL="$BASE_URL" \
NODE_NO_WARNINGS=1 \
node --experimental-specifier-resolution=node --loader ts-node/esm test-with-auth.ts

echo ""
echo "✅ Test completed!"
echo ""
echo "📋 Screenshots saved to current directory:"
echo "   - step1-initial-page.png"
echo "   - step2-before-submit.png (if auth required)"
echo "   - step2-after-auth.png (if auth required)"
echo "   - step3-companies-page.png"
echo "   - step5-after-add-click.png (if button found)"
echo ""
echo "💡 Tips for next iteration:"
echo "   1. If auth failed, check the credentials"
echo "   2. If add button not found, check the companies page layout"
echo "   3. If dialog not in UI state, check browser console for React errors"
echo "   4. Screenshots will help debug each step"