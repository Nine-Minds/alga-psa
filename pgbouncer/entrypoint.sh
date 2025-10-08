#!/bin/sh
set -e

# Enable better error reporting
trap 'echo "Error occurred at line $LINENO with exit code $?"' ERR

# Redirect stderr to stdout for Docker logging
exec 2>&1

# Read secrets into environment variables with shell safety
# Use IFS= and read -r to preserve whitespace and special characters
if [ ! -f /run/secrets/postgres_password ]; then
    echo "Error: /run/secrets/postgres_password not found" >&2
    exit 1
fi

POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)
export POSTGRES_PASSWORD

# Default superuser credential for PgBouncer admin connections
POSTGRES_SUPERUSER_NAME=${POSTGRES_USER:-postgres}

# Optional secret for application user (required for PgBouncer auth)
DB_USER_SERVER_NAME=${DB_USER_SERVER:-app_user}
DB_PASSWORD_SERVER_FILE=/run/secrets/db_password_server
if [ ! -f "$DB_PASSWORD_SERVER_FILE" ]; then
    echo "Error: $DB_PASSWORD_SERVER_FILE not found" >&2
    exit 1
fi
DB_PASSWORD_SERVER=$(cat "$DB_PASSWORD_SERVER_FILE")
DB_PASSWORD_MD5=$(printf "%s%s" "$DB_PASSWORD_SERVER" "$DB_USER_SERVER_NAME" | md5sum | awk '{print $1}')
POSTGRES_PASSWORD_MD5=$(printf "%s%s" "$POSTGRES_PASSWORD" "$POSTGRES_SUPERUSER_NAME" | md5sum | awk '{print $1}')

echo "Config files created successfully" >&2

# Substitute environment variables in pgbouncer.ini
# Set default for POSTGRES_HOST if not provided (envsubst doesn't support ${VAR:-default})
: "${POSTGRES_HOST:=postgres}"
export POSTGRES_HOST
envsubst '$POSTGRES_HOST' < /etc/pgbouncer/pgbouncer.ini.template > /etc/pgbouncer/pgbouncer.ini

# Generate userlist for PgBouncer authentication compatible with auth_type=md5.
{
  printf '"%s" "md5%s"\n' "$DB_USER_SERVER_NAME" "$DB_PASSWORD_MD5"
  printf '"%s" "md5%s"\n' "$POSTGRES_SUPERUSER_NAME" "$POSTGRES_PASSWORD_MD5"
} > /etc/pgbouncer/userlist.txt
chmod 600 /etc/pgbouncer/userlist.txt

# Clear sensitive environment variables for security
unset POSTGRES_PASSWORD
unset DB_PASSWORD_SERVER

# Start pgbouncer
# Run pgbouncer as postgres user in foreground mode for Docker
echo "Starting pgbouncer as postgres user..." >&2
su postgres -c "pgbouncer /etc/pgbouncer/pgbouncer.ini"
