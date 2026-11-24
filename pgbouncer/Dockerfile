FROM edoburu/pgbouncer:latest

# Start as root to read secrets and set permissions, then drop to postgres user
USER root

# Install envsubst only (not full gettext) for safe variable substitution
RUN apk add --no-cache gettext-envsubst

# Copy configuration templates and entrypoint
COPY pgbouncer.ini.template /etc/pgbouncer/pgbouncer.ini.template
COPY entrypoint.sh /entrypoint.sh

# Set permissions
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]