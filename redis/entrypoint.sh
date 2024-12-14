#!/bin/bash
set -e

# Function to log with timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Get Redis password from secrets
REDIS_PASSWORD=$(cat /run/secrets/redis_password)

# Create Redis config
cat > /usr/local/etc/redis/redis.conf << EOF
# Basic configuration
port 6379
bind 0.0.0.0

# Security
requirepass "${REDIS_PASSWORD}"

# Persistence
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
