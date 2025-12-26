#!/bin/bash

# Script to validate secret files before Docker Compose operations

SECRETS_DIR="./secrets"
ERRORS=0

echo "Validating secret files..."

# Check if secrets directory exists
if [ ! -d "$SECRETS_DIR" ]; then
    echo "Error: Secrets directory not found at $SECRETS_DIR"
    exit 1
fi

# List of required secret files
REQUIRED_SECRETS=(
    "postgres_password"
    "db_password_server"
    "db_password_hocuspocus"
    "redis_password"
    "alga_auth_key"
    "crypto_key"
    "token_secret_key"
    "nextauth_secret"
)

for secret in "${REQUIRED_SECRETS[@]}"; do
    file="$SECRETS_DIR/$secret"
    
    # Check if file exists
    if [ ! -f "$file" ]; then
        echo "❌ Missing: $file"
        ERRORS=$((ERRORS + 1))
        continue
    fi
    
    # Check if file is empty
    if [ ! -s "$file" ]; then
        echo "❌ Empty: $file"
        ERRORS=$((ERRORS + 1))
        continue
    fi
    
    # Check for trailing newline (required for 'read' command)
    if [ "$(tail -c 1 "$file" | wc -l)" -eq 0 ]; then
        echo "⚠️  No trailing newline: $file (fixing...)"
        echo "" >> "$file"
    fi
    
    # Check for multiple lines (passwords should be single line)
    lines=$(wc -l < "$file")
    if [ "$lines" -gt 1 ]; then
        echo "⚠️  Multiple lines detected in $file (expected single line)"
    fi
    
    echo "✅ Valid: $file"
done

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo "❌ Validation failed with $ERRORS errors"
    exit 1
else
    echo ""
    echo "✅ All secrets validated successfully"
fi