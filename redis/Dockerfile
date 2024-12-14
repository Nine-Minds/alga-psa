FROM redis:latest

# Install any additional tools needed
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/redis

# Create directory for Redis config
RUN mkdir -p /usr/local/etc/redis

# Copy entrypoint script
COPY redis/entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

# Set the entrypoint script
ENTRYPOINT ["./entrypoint.sh"]
