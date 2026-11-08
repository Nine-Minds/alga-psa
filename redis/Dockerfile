FROM redis:8.10

# Install any additional tools needed
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/redis

# Config and data directories are owned by uid 1000, the same uid that owns the
# shared redis_password secret file, so Redis can read it and write its RDB
# snapshot without running as root.
RUN install -d -o 1000 -g 1000 -m 0700 /usr/local/etc/redis /data

# Copy entrypoint script
COPY redis/entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

USER 1000:1000

# Set the entrypoint script
ENTRYPOINT ["./entrypoint.sh"]
