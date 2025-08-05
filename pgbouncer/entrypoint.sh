#!/bin/sh
set -e

# Read secrets into environment variables
export POSTGRES_PASSWORD=$(cat /run/secrets/postgres_password)
export DB_PASSWORD_SERVER=$(cat /run/secrets/db_password_server)

# Use envsubst to safely substitute passwords - handles ALL special characters perfectly
# Only substitute the specific variables we want (for security)
envsubst '$POSTGRES_PASSWORD $DB_PASSWORD_SERVER' < /etc/pgbouncer/userlist.txt.template > /etc/pgbouncer/userlist.txt

# Substitute environment variables in pgbouncer.ini
# Default POSTGRES_HOST to 'postgres' if not set
export POSTGRES_HOST=${POSTGRES_HOST:-postgres}
envsubst '$POSTGRES_HOST' < /etc/pgbouncer/pgbouncer.ini.template > /etc/pgbouncer/pgbouncer.ini

# Clear sensitive environment variables for security
unset POSTGRES_PASSWORD
unset DB_PASSWORD_SERVER

# Start pgbouncer
# Use standard su to switch user (target user is 'postgres' based on whoami)
exec su -s /bin/sh -c 'pgbouncer /etc/pgbouncer/pgbouncer.ini' postgres
