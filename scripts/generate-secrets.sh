#!/bin/bash
set -euo pipefail

# Idempotent, secure secret bootstrap for Docker Compose deployments.
#
# Creates any missing REQUIRED_SECRETS file under ./secrets with a
# cryptographically random single-line value (mode 0600, dir 0700). Existing
# files are NEVER overwritten: reruns preserve the original values, which is
# what keeps a persistent database working across restarts.
#
# This is the generator behind validate-secrets.sh and
# docker-compose-wrapper.sh, so a fresh checkout bootstraps every required
# secret — including the EE credentials-vault credential_encryption_key — with
# no manual steps. Files are created before `docker compose up` runs, so
# compose never sees a referenced secret whose file is missing.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="${SECRETS_DIR:-$REPO_ROOT/secrets}"

REQUIRED_SECRETS=(
  "postgres_password"
  "db_password_server"
  "db_password_hocuspocus"
  "redis_password"
  "email_password"
  "crypto_key"
  "token_secret_key"
  "nextauth_secret"
  "credential_encryption_key"
  "google_oauth_client_id"
  "google_oauth_client_secret"
  "alga_auth_key"
)

generate_secret() {
  local name="$1"
  local file="$SECRETS_DIR/$name"

  # Already provisioned (and non-empty): preserve it across reruns.
  if [ -s "$file" ]; then
    echo "Present (preserved): secrets/$name"
    return 0
  fi

  local value
  value="$(openssl rand -hex 32)"
  printf '%s\n' "$value" > "$file"
  chmod 600 "$file"
  echo "Generated: secrets/$name"
}

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

for name in "${REQUIRED_SECRETS[@]}"; do
  generate_secret "$name"
done

echo ""
echo "✅ All required secrets are present under $SECRETS_DIR"
