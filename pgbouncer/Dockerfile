FROM edoburu/pgbouncer:latest

# Install envsubst only (not full gettext) for safe variable substitution
RUN apk add --no-cache gettext-envsubst

# Copy configuration templates and entrypoint
COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini.template
COPY userlist.txt.template /etc/pgbouncer/userlist.txt.template
COPY entrypoint.sh /entrypoint.sh

# Set permissions
RUN chmod 600 /etc/pgbouncer/userlist.txt.template && \
    chmod +x /entrypoint.sh

# Start as root to read secrets and set permissions, then drop to postgres user
USER root

ENTRYPOINT ["/entrypoint.sh"]