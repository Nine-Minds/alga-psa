#!/bin/sh
set -e

# Create temporary file for userlist
TEMP_USERLIST=$(mktemp)

# Generate userlist.txt with passwords from secrets
echo "\"postgres\" \"$(cat /run/secrets/postgres_password)\"" > $TEMP_USERLIST
echo "\"app_user\" \"$(cat /run/secrets/db_password_server)\"" >> $TEMP_USERLIST

# Copy to pgbouncer directory with correct permissions
cat $TEMP_USERLIST > /etc/pgbouncer/userlist.txt
rm $TEMP_USERLIST

# Ensure proper permissions
if [ "$(id -u)" = "0" ]; then
  chmod 600 /etc/pgbouncer/userlist.txt
  chown pgbouncer:pgbouncer /etc/pgbouncer/userlist.txt
fi

# Start pgbouncer
exec pgbouncer /etc/pgbouncer/pgbouncer.ini