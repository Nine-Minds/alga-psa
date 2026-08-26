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
#    it is safe) and only when it is truly absent. Before anything is written,
#    a read-only preflight validates the whole set: every present-but-empty or
#    broken-symlink secret (including `credential_encryption_key` itself) and
#    every missing non-migration secret fails loudly, so a failed run can never
#    leave a partially mutated installation.
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
    # Any managed-secret entry means this is not a fresh installation. In
    # particular, an empty file must fail in the existing-install path rather
    # than being mistaken for a fresh directory and silently regenerated.
    # Count broken symlinks as entries too so they also fail closed.
    if [ -e "$SECRETS_DIR/$name" ] || [ -L "$SECRETS_DIR/$name" ]; then
      return 0
    fi
  done
  return 1
}

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if has_established_secret; then
  # Existing/partial installation. Run a READ-ONLY preflight over every managed
  # secret first; nothing is written until the whole set is known to be valid
  # (or the sole permitted auto-add — the migration secret, only when it is
  # truly absent — is the only remaining gap). This guarantees a failed run
  # never leaves a partially mutated installation behind.
  generate_migration_secret=0
  for name in "${ALL_SECRETS[@]}"; do
    file="$SECRETS_DIR/$name"
    if [ -s "$file" ]; then
      # Present and non-empty: valid, preserved below.
      :
    elif [ -e "$file" ] || [ -L "$file" ]; then
      # Present but empty, or a broken symlink: an established secret whose
      # value cannot be read. NEVER regenerate it — even the migration secret:
      # an empty/broken entry means the installation already manages this
      # secret, and silently replacing it can break database access,
      # invalidate sessions, or make encrypted data unrecoverable.
      echo "❌ Empty or broken established secret: $file" >&2
      echo "   Refusing to regenerate it: replacing an existing deployment's" >&2
      echo "   secret can break database access, invalidate sessions, or make" >&2
      echo "   encrypted data unrecoverable. Restore it from backup or" >&2
      echo "   provision it manually, then re-run." >&2
      exit 1
    elif [ "$name" = "$MIGRATION_SECRET" ]; then
      # Truly absent and it is the migration secret: the only permitted
      # auto-add, deferred until the preflight has passed for every other
      # established secret.
      generate_migration_secret=1
    else
      # Missing non-migration secret on an existing install: fail loudly.
      echo "❌ Missing established secret: $file" >&2
      echo "   Refusing to regenerate it: replacing an existing deployment's" >&2
      echo "   secret can break database access, invalidate sessions, or make" >&2
      echo "   encrypted data unrecoverable. Restore it from backup or" >&2
      echo "   provision it manually, then re-run." >&2
      exit 1
    fi
  done

  # Preflight passed: preserve every valid established value and auto-add the
  # migration secret only if it was truly absent. Every failure case above
  # exited before reaching here, so no partial write is possible.
  for name in "${ALL_SECRETS[@]}"; do
    file="$SECRETS_DIR/$name"
    if [ -s "$file" ]; then
      echo "Present (preserved): secrets/$name"
    elif [ "$name" = "$MIGRATION_SECRET" ] && [ "$generate_migration_secret" -eq 1 ]; then
      generate_secret "$name"
    else
      # Unreachable after a passing preflight; fail loudly rather than silently
      # skipping a write if the preflight logic ever regresses.
      echo "❌ Unexpected secret state for $file after a passing preflight." >&2
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
