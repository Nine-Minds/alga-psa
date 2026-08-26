#!/bin/bash
set -euo pipefail

# Script to validate secret files before Docker Compose operations.
# Bootstraps any missing required secret first (see generate-secrets.sh: fresh
# dirs get the full set; existing dirs preserve values, auto-add only
# credential_encryption_key, and fail loudly on other missing established
# secrets), then validates every required file. Generator failure terminates
# this script before any validation runs (no partial/passed validation on a
# failed bootstrap).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Default to the repo-root secrets dir (same as generate-secrets.sh and the
# compose files' `./secrets/*` mounts); honor SECRETS_DIR when set.
SECRETS_DIR="${SECRETS_DIR:-$REPO_ROOT/secrets}"

# Bootstrap any missing required secret before validating (idempotent).
SECRETS_DIR="$SECRETS_DIR" "$SCRIPT_DIR/generate-secrets.sh"

ERRORS=0

echo "Validating secret files..."

# List of required secret files
REQUIRED_SECRETS=(
    "postgres_password"
    "db_password_server"
    "db_password_hocuspocus"
    "redis_password"
    "crypto_key"
    "token_secret_key"
    "nextauth_secret"
    "credential_encryption_key"
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