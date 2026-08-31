# Secrets Management

This document outlines how sensitive data is managed in the application using Docker secrets.

## Overview

Instead of storing sensitive data in environment variables or configuration files, we use Docker secrets to securely manage sensitive information. This approach provides several benefits:

- Secrets are stored securely on disk
- Secrets are only mounted in containers that need them
- Secrets are never exposed in container inspection or logs
- Secrets are mounted as files, providing a consistent interface across services

## Secret Files

All secrets are stored in the `secrets/` directory at the project root. Each secret is stored in its own file:

> **Bootstrap:** `./scripts/generate-secrets.sh` is the persisted, idempotent
> bootstrap for the Compose flow. On a **fresh** directory it creates every
> required secret file with a cryptographically random value (mode `0600`) and
> **never overwrites an existing file**, so it is safe to re-run. On an
> **existing/partial** installation it preserves every established value, the
> only auto-add is the newly introduced `credential_encryption_key` (no
> ciphertext was ever encrypted with it), and it **fails loudly** instead of
> regenerating any other missing/empty established secret — silently replacing a
> live deployment's database/auth/encryption secret would break database
> access, invalidate sessions, or make encrypted data unrecoverable. It is
> invoked automatically by `scripts/docker-compose-wrapper.sh` before
> `docker compose` and by `scripts/validate-secrets.sh` before validation; a
> generator failure stops both callers (`set -e`).

### Database Secrets
- `postgres_password` - PostgreSQL admin password (used by 'postgres' user for administration)
- `db_password_server` - Application user password (used by 'app_user' for application database access)
- `db_password_hocuspocus` - Hocuspocus service password

### Redis Secrets
- `redis_password` - Redis password

### Email Secrets
- `email_password` - SMTP server password

### Security Secrets
- `crypto_key` - Encryption key for sensitive data
- `token_secret_key` - JWT signing key
- `nextauth_secret` - NextAuth.js secret key
- `credential_encryption_key` - Credentials vault encryption key (EE). Auto-generated per deployment; rotation invalidates previously stored vault ciphertext and is a follow-up.

### OAuth Secrets
- `google_oauth_client_id` - Google OAuth client ID
- `google_oauth_client_secret` - Google OAuth client secret

## Usage in Docker Compose

Secrets are defined in the `docker-compose.yaml` file under the `secrets` section and mounted to services that need them. For example:

```yaml
secrets:
  postgres_password:
    file: ./secrets/postgres_password
  db_password_server:
    file: ./secrets/db_password_server

services:
  postgres:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password

  server:
    environment:
      DB_USER_SERVER: app_user
    volumes:
      - type: bind
        source: ./secrets/db_password_server
        target: /run/secrets/db_password_server
        read_only: true
```

## Accessing Secrets in Containers

Secrets are mounted at `/run/secrets/<secret_name>` inside containers. Services should read secrets from these mounted files rather than environment variables.

Example of reading a secret in Node.js:
```javascript
const fs = require('fs');
const dbPassword = fs.readFileSync('/run/secrets/db_password_server', 'utf8').trim();
```

## Database Authentication

The system uses a two-user database authentication model for security:

1. Admin User (postgres):
   - Username: postgres
   - Password: Stored in postgres_password secret
   - Used for:
     * Database administration
     * Setup and migrations
     * Schema changes
     * Full database access

2. Application User (app_user):
   - Username: app_user
   - Password: Stored in db_password_server secret
   - Used for:
     * Application database access
     * Regular database operations
   - Security:
     * Cannot modify schema
     * Tenant isolation is application-enforced (see [tenant-isolation.md](../architecture/tenant-isolation.md)); there are no RLS policies

## Security Considerations

1. Never commit secret files to version control
2. Add secret files to .gitignore
3. Use different secrets for different environments
4. Rotate secrets periodically
5. Limit secret access to only the services that need them
6. Use strong, unique passwords for each secret
7. Ensure proper file permissions on secret files
8. Follow principle of least privilege:
   - Use app_user for application access
   - Reserve postgres user for administration only

## Setting Up Secrets

1. Create the `secrets/` directory
2. Create individual files for each secret:
```bash
# Use single quotes to avoid shell expansion of special characters in secret values.
# If a value contains a single quote ('), use a quoted heredoc instead:
# cat > secrets/email_password <<'EOF'
# your-secret-value
# EOF

# Database
echo 'your-secure-admin-password' > secrets/postgres_password
echo 'your-secure-app-password' > secrets/db_password_server
echo 'your-secure-hocuspocus-password' > secrets/db_password_hocuspocus

# Redis
echo 'your-secure-password' > secrets/redis_password

# Security
echo 'your-32-char-min-key' > secrets/crypto_key
echo 'your-32-char-min-key' > secrets/token_secret_key
echo 'your-32-char-min-key' > secrets/nextauth_secret
echo "$(openssl rand -base64 32)" > secrets/credential_encryption_key

# Email & OAuth
echo 'your-email-password' > secrets/email_password
echo 'your-client-id' > secrets/google_oauth_client_id
echo 'your-client-secret' > secrets/google_oauth_client_secret
```

3. Set appropriate permissions:
```bash
chmod 600 secrets/*
```

4. Update docker-compose files to use secrets
5. Update application code to read from secret files

## Environment Variables

The `.env.example` file indicates which values are managed via Docker secrets. When setting up a new environment:

1. Copy `.env.example` to `.env`
2. Fill in non-sensitive values in `.env`
3. Create corresponding secret files for sensitive values

## Tenant Secrets on the Filesystem

Tenant-scoped secrets (OAuth tokens for QBO/Xero, Gmail service-account keys, and
similar runtime credentials) are written by the application through the secret
provider abstraction. When `SECRET_WRITE_PROVIDER=filesystem`, they are stored
under the filesystem secret root as:

```
<SECRET_FS_BASE_PATH>/tenants/<tenantId>/<secretName>
```

The filesystem provider maintains strict permissions on this store,
independent of the process umask:

- Every directory (`<root>`, `tenants/`, and each tenant directory) is
  `0700`. Directories are created with an explicit `0700` mode and re-checked
  with `chmod` where they may already exist.
- Every secret file is `0600`. Writes go through an exclusively-created
  (`O_EXCL`) temporary file in the same directory, are `fsync`ed, and are then
  atomically `rename()`d over the target — a crash or interruption mid-write
  never leaves a partial file at the final path, and a rewrite always ends at
  `0600`.
- Tenant IDs and secret names are validated as single path components; the
  resolved path must stay under the secret root.
- The provider refuses to write through symlinks or non-regular files, and
  validates the secret root before the first write: a root that is missing,
  a symlink, not a directory, owned by another user, or not mode `0700` causes
  writes to be refused with a precise operator message. Reads are unaffected,
  so existing deployments continue to boot; only writes fail closed.
- Secret values are never written to logs; only paths are logged.

### Operator message on refused writes

When the secret root cannot be made safe, writes fail with a message naming the
exact path and the fix, for example:

```
Filesystem secret store at /var/lib/alga/tenant-secrets is not safe for secret
writes: it has mode 755. Expected a real directory owned by uid 1000 with mode
0700. Refusing secret writes; reads continue. Fix with: sudo chown 1000
/var/lib/alga/tenant-secrets && sudo chmod 700 /var/lib/alga/tenant-secrets, or
run scripts/repair-secret-permissions.sh --apply --path
/var/lib/alga/tenant-secrets (see docs/security/secrets_management.md).
```

### Repairing an existing store

Installs created before the strict-modes behavior (or restored from a backup
that preserved a permissive umask or a different volume owner) may hold `0755`
directories, `0644` secret files, or entries owned by another uid. Run the
non-destructive repair script to bring the store in line. It never deletes,
rewrites, or reads out secret contents, and never follows symlinks:

```bash
# 1. Report what would change (no changes made). Exits 0 only when the store
#    is already fully safe; exits 1 when anything needs fixing:
scripts/repair-secret-permissions.sh --path <SECRET_FS_BASE_PATH>

# 2a. Modes only wrong (owner already correct) — run as the service user:
scripts/repair-secret-permissions.sh --apply --path <SECRET_FS_BASE_PATH>

# 2b. Ownership also wrong — run as root with the service uid; this chowns
#     every entry, including the store root itself, to that uid:
sudo scripts/repair-secret-permissions.sh --apply --path <SECRET_FS_BASE_PATH> --uid 1000

# 3. Verify: the dry run now reports a clean store and exits 0:
scripts/repair-secret-permissions.sh --path <SECRET_FS_BASE_PATH>
```

`--apply` repeats its walk until nothing more can be fixed, so directories that
were untraversable before their own repair (e.g. mode `0000`) are descended
into and their contents repaired too. It exits `0` only when the store ends
fully safe for provider writes — correct modes **and** uniform ownership; any
remaining issue (a symlink, a non-regular entry, or ownership that needs
root + `--uid`) is reported and the exit status is `1`, so the script never
claims success while the provider would still refuse writes.

Without `--path`, the script uses `SECRET_FS_BASE_PATH` (or `<repo>/secrets`).
Without `--uid`, the store root's current owner is treated as the expected
owner and mismatched entries are reported (fixing them requires root +
`--uid`). Symlinks and non-regular entries are reported for manual
intervention and are never changed.

## Best Practices

1. Always use secrets for sensitive data, never environment variables
2. Read secrets from files at runtime, not during build
3. Use consistent naming across all components
4. Document any changes to secret management
5. Keep secret files secure and backed up
6. Implement proper secret rotation procedures
7. Monitor secret usage and access patterns
8. Follow the principle of least privilege:
   - Use app_user for normal operations
   - Limit postgres user access to administration
   - Keep application queries tenant-scoped through the `tenantDb` facade
