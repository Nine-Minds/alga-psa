#!/bin/bash

# Generate all required secrets for Alga PSA
# Usage: ./scripts/generate-secrets.sh [--force] [--auto]
#
# By default, this script will NOT overwrite existing secrets.
# Use --force to regenerate all secrets (WARNING: may break existing installations)
# Use --auto to skip interactive prompts and auto-generate all secrets

set -e

SECRETS_DIR="./secrets"
FORCE=false
AUTO_MODE=false
INTERACTIVE_MODE=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --force)
            FORCE=true
            ;;
        --auto)
            AUTO_MODE=true
            ;;
    esac
done

# Auto-detect non-interactive environments (CI/CD, piped input, etc.)
# and enable auto mode to prevent hanging on prompts
if [ "$AUTO_MODE" = false ] && [ ! -t 0 ]; then
    echo "INFO: Non-interactive environment detected. Using auto-generate mode."
    echo "      Use --auto flag explicitly to suppress this message."
    AUTO_MODE=true
fi

if [ "$FORCE" = true ] && [ "$AUTO_MODE" = false ]; then
    echo "WARNING: --force flag detected. Existing secrets will be overwritten."
    echo "This may break existing database connections!"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
elif [ "$FORCE" = true ] && [ "$AUTO_MODE" = true ]; then
    echo "WARNING: --force flag detected. Existing secrets will be overwritten."
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
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

# Create secrets directory
mkdir -p "$SECRETS_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "              Alga PSA - Secrets Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Prompt for generation mode if not using --auto
if [ "$AUTO_MODE" = false ]; then
    echo "How would you like to set up your secrets?"
    echo ""
    echo "  1) Auto-generate all secrets (Recommended)"
    echo "     Secure random passwords will be generated automatically."
    echo ""
    echo "  2) Enter secrets manually"
    echo "     You'll be prompted to enter each password/secret."
    echo ""
    read -p "Choose an option [1]: " MODE_CHOICE
    MODE_CHOICE=${MODE_CHOICE:-1}

    if [ "$MODE_CHOICE" = "2" ]; then
        INTERACTIVE_MODE=true
        echo ""
        echo -e "${BLUE}Manual mode selected.${NC}"
        echo "For each secret, you can enter your own value or press Enter to auto-generate."
        echo "Passwords should be at least 16 characters for security."
    else
        echo ""
        echo -e "${BLUE}Auto-generate mode selected.${NC}"
    fi
fi

echo ""
echo "Generating secrets for Alga PSA..."
echo ""

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

# Function to prompt for a secret in interactive mode
prompt_secret() {
    local name=$1
    local min_length=${2:-16}
    local description=$3
    local secret=""

    # All status messages go to stderr so they don't interfere with the return value
    echo "" >&2
    echo -e "${BLUE}$description${NC} ($name)" >&2
    echo "  Minimum length: $min_length characters" >&2

    while true; do
        read -sp "  Enter value (or press Enter to auto-generate): " secret </dev/tty
        echo "" >&2

        # If empty, auto-generate
        if [ -z "$secret" ]; then
            secret=$(generate_secret "$min_length")
            echo -e "  ${GREEN}Auto-generated${NC}" >&2
            break
        fi

        # Validate minimum length
        if [ ${#secret} -lt $min_length ]; then
            echo -e "  ${RED}Error: Must be at least $min_length characters. Please try again.${NC}" >&2
            continue
        fi

        # Confirm the password
        read -sp "  Confirm value: " confirm </dev/tty
        echo "" >&2

        if [ "$secret" != "$confirm" ]; then
            echo -e "  ${RED}Error: Values don't match. Please try again.${NC}" >&2
            continue
        fi

        echo -e "  ${GREEN}Value accepted${NC}" >&2
        break
    done

    echo "$secret"
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

    if [ "$INTERACTIVE_MODE" = true ]; then
        # Interactive mode: prompt for value
        local secret_value
        secret_value=$(prompt_secret "$name" "$length" "$description")
        echo "$secret_value" > "$file"
        # echo already adds a newline, so no need to add another
    else
        # Auto mode: generate random secret
        generate_secret "$length" > "$file"
        # generate_secret uses head -c which doesn't add newline, so add one
        echo "" >> "$file"
    fi

    chmod 600 "$file"
    echo -e "${GREEN}CREATE${NC} $name - $description"
}

# Section header helper
print_section() {
    if [ "$INTERACTIVE_MODE" = true ]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo -e "${BLUE}$1${NC}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
        echo "$1:"
    fi
}

# Database secrets
print_section "Database secrets"
create_secret "postgres_password" 24 "PostgreSQL admin password"
create_secret "db_password_server" 24 "Application database password"
create_secret "db_password_hocuspocus" 24 "Hocuspocus service database password"

if [ "$INTERACTIVE_MODE" = false ]; then echo ""; fi
print_section "Cache secrets"
create_secret "redis_password" 24 "Redis cache password"

if [ "$INTERACTIVE_MODE" = false ]; then echo ""; fi
print_section "Authentication secrets"
create_secret "alga_auth_key" 32 "Alga authentication key (min 32 chars)"
create_secret "nextauth_secret" 32 "NextAuth.js secret"

if [ "$INTERACTIVE_MODE" = false ]; then echo ""; fi
print_section "Encryption secrets"
create_secret "crypto_key" 32 "Data encryption key (min 32 chars)"
create_secret "token_secret_key" 32 "Token signing key (min 32 chars)"

if [ "$INTERACTIVE_MODE" = false ]; then echo ""; fi
print_section "Optional secrets (configure for production)"

# Function to prompt for optional secrets (allows empty values)
prompt_optional_secret() {
    local name=$1
    local description=$2
    local value=""

    echo "" >&2
    echo -e "${BLUE}$description${NC} ($name)" >&2
    echo "  This is optional. Press Enter to skip (creates placeholder)." >&2

    read -sp "  Enter value (or press Enter to skip): " value </dev/tty
    echo "" >&2

    if [ -z "$value" ]; then
        echo "placeholder-configure-for-production"
        echo -e "  ${YELLOW}Skipped (placeholder created)${NC}" >&2
    else
        echo "$value"
        echo -e "  ${GREEN}Value accepted${NC}" >&2
    fi
}

# Create placeholder files for optional secrets (won't overwrite existing)
create_placeholder() {
    local name=$1
    local description=$2
    local file="$SECRETS_DIR/$name"

    if [ -f "$file" ]; then
        echo -e "${YELLOW}SKIP${NC} $name (already exists)"
        return
    fi

    if [ "$INTERACTIVE_MODE" = true ]; then
        local secret_value
        secret_value=$(prompt_optional_secret "$name" "$description")
        echo "$secret_value" > "$file"
    else
        echo "placeholder-configure-for-production" > "$file"
        echo -e "${GREEN}CREATE${NC} $name - $description (placeholder)"
    fi

    chmod 600 "$file"
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
