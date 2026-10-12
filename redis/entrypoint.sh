#!/bin/bash
set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# The config file embeds the password, so keep it private to this user.
umask 077

# Get Redis password from secrets
PASSWORD_FILE=/run/secrets/redis_password
if [ ! -r "$PASSWORD_FILE" ]; then
    echo "ERROR: $PASSWORD_FILE is missing or not readable by uid $(id -u). Redis runs as a non-root user; the runtime-permissions init service normally fixes ownership of ./secrets/*. Run: sudo chown 1000:1000 secrets/redis_password && sudo chmod 600 secrets/redis_password" >&2
    exit 1
fi
REDIS_PASSWORD=$(cat "$PASSWORD_FILE")

# Create Redis config
cat > /usr/local/etc/redis/redis.conf << EOF
# Basic configuration
port 6379
bind 0.0.0.0

# Security
requirepass "${REDIS_PASSWORD}"

# Persistence
dir /data
save 20 1

# Logging
loglevel debug

# Performance tuning
maxmemory 256mb
maxmemory-policy allkeys-lru

# Connection
tcp-keepalive 300
timeout 0

# TLS/SSL
tls-port 0

# Snapshotting
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
EOF

log "Starting Redis server..."
exec redis-server /usr/local/etc/redis/redis.conf
