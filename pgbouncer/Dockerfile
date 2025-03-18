FROM edoburu/pgbouncer:latest

COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]