#!/bin/bash

# Build Wrapper Script
# Runs npm build commands and returns structured JSON results
# Always exits with code 0 so PostToolUse hook can process the results

cd server 2>/dev/null || cd /home/coder/alga-psa/server

# Run the npm build command with any provided arguments and capture output
OUTPUT=$(npm run build "$@" 2>&1)
EXIT_CODE=$?

# Create JSON response
if [ $EXIT_CODE -eq 0 ]; then
    STATUS="success"
    MESSAGE="Build completed successfully"
else
    STATUS="failure"
    MESSAGE="Build failed"
fi

# Output structured JSON
cat <<EOF
{
  "build_result": {
    "status": "$STATUS",
    "exit_code": $EXIT_CODE,
    "message": "$MESSAGE",
    "output": $(echo "$OUTPUT" | jq -R -s .)
  }
}
EOF

# Always exit 0 so the hook gets triggered
exit 0