FROM edoburu/pgbouncer:latest

# Install envsubst for safe variable substitution (only ~2MB)
RUN apk add --no-cache gettext

# Copy configuration templates and entrypoint
COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini.template
COPY userlist.txt.template /etc/pgbouncer/userlist.txt.template
COPY entrypoint.sh /entrypoint.sh

# Set permissions
RUN chmod 600 /etc/pgbouncer/userlist.txt.template && \
    chmod +x /entrypoint.sh

USER root

ENTRYPOINT ["/entrypoint.sh"]