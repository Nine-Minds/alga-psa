#!/bin/bash

# Docker Compose wrapper with automatic secret validation
# This script ensures secrets are properly formatted before running Docker Compose

# Function to validate and fix secret files
validate_and_fix_secrets() {
    local SECRETS_DIR="./secrets"
    
    # Skip if no secrets directory
    [ ! -d "$SECRETS_DIR" ] && return 0
    
    # Check all secret files in the directory
    for file in "$SECRETS_DIR"/*; do
        [ ! -f "$file" ] && continue
        
        # Skip non-secret files (like README)
        basename=$(basename "$file")
        [[ "$basename" == "README"* ]] && continue
        [[ "$basename" == "."* ]] && continue
        
        # Check and fix missing newlines silently
        if [ -s "$file" ] && [ "$(tail -c 1 "$file" | wc -l)" -eq 0 ]; then
            echo "" >> "$file"
            echo "Fixed missing newline in: secrets/$basename"
        fi
    done
}

# Validate secrets before running docker compose
validate_and_fix_secrets

# Pass through to docker compose with all arguments
docker compose "$@"