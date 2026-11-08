#!/bin/sh
set -e

# Enable better error reporting
trap 'echo "Error occurred at line $LINENO with exit code $?"' ERR

# Redirect stderr to stdout for Docker logging
exec 2>&1

# read_secret <file>: print the secret with leading/trailing whitespace
# (including \r) removed. Keep this aligned with the clients, which trim()
# the same files (packages/core/src/lib/secrets/FileSystemSecretProvider.ts),
# otherwise the hash below would differ from what the client sends.
# Fails closed (exit 1) when the file is missing or the result is empty.
read_secret() {
    if [ ! -f "$1" ]; then
        echo "Error: $1 not found" >&2
        exit 1
    fi
    _secret=$(cat "$1")
    while :; do
        case "$_secret" in
            [[:space:]]*) _secret=${_secret#?} ;;
            *) break ;;
        esac
    done
    while :; do
        case "$_secret" in
            *[[:space:]]) _secret=${_secret%?} ;;
            *) break ;;
        esac
    done
    if [ -z "$_secret" ]; then
        echo "Error: $1 is empty; refusing to start" >&2
        exit 1
    fi
    printf '%s' "$_secret"
}

# The application user is the only account served through PgBouncer. The Postgres
# superuser is deliberately not listed: administration connects to Postgres directly.
DB_USER_SERVER_NAME=${DB_USER_SERVER:-app_user}
DB_PASSWORD_SERVER_FILE=/run/secrets/db_password_server
DB_PASSWORD_SERVER=$(read_secret "$DB_PASSWORD_SERVER_FILE") || exit 1
DB_PASSWORD_MD5=$(printf "%s%s" "$DB_PASSWORD_SERVER" "$DB_USER_SERVER_NAME" | md5sum | awk '{print $1}')

echo "Config files created successfully" >&2

# Substitute environment variables in pgbouncer.ini
# Set default for POSTGRES_HOST if not provided (envsubst doesn't support ${VAR:-default})
: "${POSTGRES_HOST:=postgres}"
export POSTGRES_HOST
envsubst '$POSTGRES_HOST' < /etc/pgbouncer/pgbouncer.ini.template > /etc/pgbouncer/pgbouncer.ini

# Fail closed on configuration drift: a mounted override or a hand edit must not
# turn client authentication off. Every auth_type line must be md5 or
# scram-sha-256, and at least one must be present.
AUTH_TYPES=$(sed -n 's/^[[:space:]]*auth_type[[:space:]]*=[[:space:]]*\([^[:space:];#]*\).*$/\1/p' /etc/pgbouncer/pgbouncer.ini)
if [ -z "$AUTH_TYPES" ]; then
    echo "Error: pgbouncer.ini does not set auth_type; refusing to start" >&2
    exit 1
fi
for AUTH_TYPE_VALUE in $AUTH_TYPES; do
    case "$AUTH_TYPE_VALUE" in
        md5|scram-sha-256) ;;
        *)
            echo "Error: auth_type = $AUTH_TYPE_VALUE is not allowed (use md5 or scram-sha-256); refusing to start" >&2
            exit 1
            ;;
    esac
done

# Generate userlist for PgBouncer authentication compatible with auth_type=md5.
{
  printf '"%s" "md5%s"\n' "$DB_USER_SERVER_NAME" "$DB_PASSWORD_MD5"
} > /etc/pgbouncer/userlist.txt
chmod 600 /etc/pgbouncer/userlist.txt

# Clear sensitive environment variables for security
unset DB_PASSWORD_SERVER

# Start pgbouncer
# Run pgbouncer as postgres user in foreground mode for Docker
echo "Starting pgbouncer as postgres user..." >&2
su postgres -c "pgbouncer /etc/pgbouncer/pgbouncer.ini"
