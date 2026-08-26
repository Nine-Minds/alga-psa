#!/bin/bash
set -euo pipefail

# Idempotent, secure secret bootstrap for Docker Compose deployments.
#
# Two modes, chosen by whether the secrets directory already holds secrets:
#
#  - FRESH (no established secret yet): generate the full required set with a
#    cryptographically random single-line value (mode 0600, dir 0700).
#
#  - EXISTING / partial installation: NEVER regenerate established secrets —
#    replacing a live deployment's database/auth/encryption secret would break
#    database access, invalidate sessions, or make encrypted data
#    unrecoverable. Existing values are preserved; the only auto-add is the
#    credential vault's `credential_encryption_key` (the newly introduced
#    migration case — affected environments hold no ciphertext, so generating
#    it is safe). Any other missing or empty established secret fails loudly.
#
# This is the generator behind validate-secrets.sh and
# docker-compose-wrapper.sh. Files are created before `docker compose up` runs,
# so compose never sees a referenced secret whose file is missing.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_DIR="${SECRETS_DIR:-$REPO_ROOT/secrets}"

# The full documented required set (matches the Compose stack + dev guide).
ALL_SECRETS=(
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

# The only secret auto-added to an existing/partial installation. Newly
# introduced for the EE credentials vault; existing deployments never encrypted
# with it, so generating it cannot orphan ciphertext.
MIGRATION_SECRET="credential_encryption_key"

generate_secret() {
  local name="$1"
  local file="$SECRETS_DIR/$name"
  local value
  value="$(openssl rand -hex 32)"
  printf '%s\n' "$value" > "$file"
  chmod 600 "$file"
  echo "Generated: secrets/$name"
}

has_established_secret() {
  local name
  for name in "${ALL_SECRETS[@]}"; do
    if [ -s "$SECRETS_DIR/$name" ]; then
      return 0
    fi
  done
  return 1
}

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if has_established_secret; then
  # Existing/partial installation: preserve established values, auto-add only
  # the migration secret, fail loudly on any other missing/empty secret.
  for name in "${ALL_SECRETS[@]}"; do
    file="$SECRETS_DIR/$name"
    if [ -s "$file" ]; then
      echo "Present (preserved): secrets/$name"
    elif [ "$name" = "$MIGRATION_SECRET" ]; then
      generate_secret "$name"
    else
      echo "❌ Missing/empty established secret: $file" >&2
      echo "   Refusing to regenerate it: replacing an existing deployment's" >&2
      echo "   secret can break database access, invalidate sessions, or make" >&2
      echo "   encrypted data unrecoverable. Restore it from backup or" >&2
      echo "   provision it manually, then re-run." >&2
      exit 1
    fi
  done
else
  # Genuinely fresh directory: bootstrap the full set.
  for name in "${ALL_SECRETS[@]}"; do
    generate_secret "$name"
  done
fi

echo ""
echo "✅ All required secrets are present under $SECRETS_DIR"
