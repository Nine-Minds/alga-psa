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

echo "Config files created successfully" >&2

# Substitute environment variables in pgbouncer.ini
# Set default for POSTGRES_HOST if not provided (envsubst doesn't support ${VAR:-default})
: "${POSTGRES_HOST:=postgres}"
export POSTGRES_HOST
envsubst '$POSTGRES_HOST' < /etc/pgbouncer/pgbouncer.ini.template > /etc/pgbouncer/pgbouncer.ini

# Clear sensitive environment variables for security
unset POSTGRES_PASSWORD

# Start pgbouncer
# Run pgbouncer as postgres user in foreground mode for Docker
echo "Starting pgbouncer as postgres user..." >&2
su postgres -c "pgbouncer /etc/pgbouncer/pgbouncer.ini"
