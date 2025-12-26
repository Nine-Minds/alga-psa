#!/bin/bash

# Generate all required secrets for Alga PSA
# Usage: ./scripts/generate-secrets.sh [--force]
#
# By default, this script will NOT overwrite existing secrets.
# Use --force to regenerate all secrets (WARNING: may break existing installations)

set -e

SECRETS_DIR="./secrets"
FORCE=false

# Parse arguments
if [ "$1" = "--force" ]; then
    FORCE=true
    echo "WARNING: --force flag detected. Existing secrets will be overwritten."
    echo "This may break existing database connections!"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check for recommended prerequisites
if ! command -v openssl &> /dev/null; then
    echo -e "${YELLOW}WARNING${NC}: openssl is not installed."
    echo "  Secret generation will use fallback methods which may be less secure."
    echo "  For best security, install openssl:"
    echo "    - macOS: brew install openssl"
    echo "    - Ubuntu/Debian: sudo apt-get install openssl"
    echo "    - RHEL/CentOS: sudo yum install openssl"
    echo ""
fi

echo "Generating secrets for Alga PSA..."
echo ""

# Create secrets directory
mkdir -p "$SECRETS_DIR"

# Function to generate a secure random string
generate_secret() {
    local length=${1:-32}
    if command -v openssl &> /dev/null; then
        openssl rand -base64 48 | tr -d '/+=' | head -c "$length"
    elif [ -f /dev/urandom ]; then
        head -c 100 /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c "$length"
    else
        # Fallback for systems without /dev/urandom (rare edge case)
        # Use multiple sources of entropy combined
        local seed="$(date +%s)$$$(hostname 2>/dev/null || echo 'host')"
        if command -v shasum &> /dev/null; then
            echo "$seed$RANDOM" | shasum -a 256 | head -c "$length"
        elif command -v sha256sum &> /dev/null; then
            echo "$seed$RANDOM" | sha256sum | head -c "$length"
        else
            # Last resort - warn user this is not cryptographically secure
            echo "WARNING: No secure random source available. Please install openssl." >&2
            echo "$seed$RANDOM" | md5sum 2>/dev/null | head -c "$length" || echo "$seed" | head -c "$length"
        fi
    fi
}

# Function to create a secret file
create_secret() {
    local name=$1
    local length=${2:-32}
    local description=$3
    local file="$SECRETS_DIR/$name"

    if [ -f "$file" ] && [ "$FORCE" = false ]; then
        echo -e "${YELLOW}SKIP${NC} $name (already exists)"
        return
    fi

    generate_secret "$length" > "$file"
    # Ensure file ends with newline
    echo "" >> "$file"
    chmod 600 "$file"
    echo -e "${GREEN}CREATE${NC} $name - $description"
}

# Database secrets
echo "Database secrets:"
create_secret "postgres_password" 24 "PostgreSQL admin password"
create_secret "db_password_server" 24 "Application database password"
create_secret "db_password_hocuspocus" 24 "Hocuspocus service database password"

echo ""
echo "Cache secrets:"
create_secret "redis_password" 24 "Redis cache password"

echo ""
echo "Authentication secrets:"
create_secret "alga_auth_key" 32 "Alga authentication key (min 32 chars)"
create_secret "nextauth_secret" 32 "NextAuth.js secret"

echo ""
echo "Encryption secrets:"
create_secret "crypto_key" 32 "Data encryption key (min 32 chars)"
create_secret "token_secret_key" 32 "Token signing key (min 32 chars)"

echo ""
echo "Optional secrets (placeholders - configure for production):"

# Create placeholder files for optional secrets (won't overwrite existing)
create_placeholder() {
    local name=$1
    local description=$2
    local file="$SECRETS_DIR/$name"

    if [ -f "$file" ]; then
        echo -e "${YELLOW}SKIP${NC} $name (already exists)"
        return
    fi

    echo "placeholder-configure-for-production" > "$file"
    chmod 600 "$file"
    echo -e "${GREEN}CREATE${NC} $name - $description (placeholder)"
}

create_placeholder "email_password" "SMTP email password"
create_placeholder "google_oauth_client_id" "Google OAuth client ID"
create_placeholder "google_oauth_client_secret" "Google OAuth client secret"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Secrets generated successfully!${NC}"
echo ""
echo "Files created in: $SECRETS_DIR/"
echo ""
echo "Next steps:"
echo "  1. Review the generated secrets"
echo "  2. For production, replace placeholder secrets with real values"
echo "  3. Run: ./quickstart.sh  (or see docs/setup_guide.md)"
echo ""
echo "To validate secrets: ./scripts/validate-secrets.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
