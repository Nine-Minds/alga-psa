#!/bin/sh
set -e

# Read secrets into environment variables with shell safety
# Use IFS= and read -r to preserve whitespace and special characters
IFS= read -r POSTGRES_PASSWORD < /run/secrets/postgres_password
IFS= read -r DB_PASSWORD_SERVER < /run/secrets/db_password_server
export POSTGRES_PASSWORD
export DB_PASSWORD_SERVER

# Use envsubst to safely substitute passwords - handles ALL special characters perfectly
# Only substitute the specific variables we want (for security)
envsubst '$POSTGRES_PASSWORD $DB_PASSWORD_SERVER' < /etc/pgbouncer/userlist.txt.template > /etc/pgbouncer/userlist.txt

# Set proper permissions on userlist.txt (contains clear-text passwords)
chmod 600 /etc/pgbouncer/userlist.txt
chown postgres:postgres /etc/pgbouncer/userlist.txt

# Substitute environment variables in pgbouncer.ini
envsubst '$POSTGRES_HOST' < /etc/pgbouncer/pgbouncer.ini.template > /etc/pgbouncer/pgbouncer.ini

# Clear sensitive environment variables for security
unset POSTGRES_PASSWORD
unset DB_PASSWORD_SERVER

# Start pgbouncer
# Use standard su to switch user (target user is 'postgres' based on whoami)
exec su -s /bin/sh -c 'pgbouncer /etc/pgbouncer/pgbouncer.ini' postgres
