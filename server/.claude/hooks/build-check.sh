#!/bin/bash

# Claude Code Hook: Build Error Checker
# Triggers after npm run build commands to check for errors

# Read JSON input from stdin
INPUT=$(cat)

# Parse JSON to extract the correct fields
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
STDOUT=$(echo "$INPUT" | jq -r '.tool_response.stdout // empty')
STDERR=$(echo "$INPUT" | jq -r '.tool_response.stderr // empty')
INTERRUPTED=$(echo "$INPUT" | jq -r '.tool_response.interrupted // false')

# Check if this is our build wrapper command
if [[ "$TOOL_NAME" == "Bash" && "$COMMAND" == *"build-wrapper.sh"* ]]; then
    # Parse the JSON output from our wrapper
    BUILD_STATUS=$(echo "$STDOUT" | jq -r '.build_result.status // empty')
    BUILD_EXIT_CODE=$(echo "$STDOUT" | jq -r '.build_result.exit_code // empty')
    BUILD_MESSAGE=$(echo "$STDOUT" | jq -r '.build_result.message // empty')
    BUILD_OUTPUT=$(echo "$STDOUT" | jq -r '.build_result.output // empty')
    
    if [[ "$BUILD_STATUS" == "failure" ]]; then
        echo "❌ $BUILD_MESSAGE! Fix the errors and run the build again." >&2
        echo "" >&2
        echo "Build output:" >&2
        echo "$BUILD_OUTPUT" >&2
        echo "" >&2
        echo "💡 To retry: Run the build-wrapper.sh script again" >&2
        exit 2
    elif [[ "$BUILD_STATUS" == "success" ]]; then
        echo "✅ $BUILD_MESSAGE!"
    else
        echo "⚠️ Unexpected build result format"
    fi
fi

# Check if this is a regular npm run build command (fallback)
if [[ "$TOOL_NAME" == "Bash" && "$COMMAND" == *"npm run build"* && "$COMMAND" != *"build-wrapper.sh"* ]]; then
    # Check if the command was interrupted
    if [[ "$INTERRUPTED" == "true" ]]; then
        echo "❌ Build was interrupted! Complete the build and try again." >&2
        exit 2
    fi
    
    # Check if there are errors in stderr (ignore empty strings)
    if [[ -n "$STDERR" && "$STDERR" != "null" && "$STDERR" != "" ]]; then
        echo "❌ Build failed with errors! Fix the errors and build again." >&2
        echo "Errors:" >&2
        echo "$STDERR" >&2
        exit 2
    fi
    
    # Also check for common error patterns in the output
    if echo "$STDOUT" | grep -qi "compilation.*error\|build.*failed\|error.*occurred"; then
        echo "❌ Build completed with errors! Fix the errors and build again." >&2
        exit 2
    fi
    
    # If we get here, build was successful
    echo "✅ Build completed successfully!"
fi