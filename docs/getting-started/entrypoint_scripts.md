# Service Entry Point Scripts

This document describes the entrypoint script structure implemented for each service in the Docker Compose setup.

## Overview

Each service has a dedicated entrypoint script that handles initialization, dependency checks, and startup procedures. This approach provides:

- Better error handling and logging
- Proper dependency management
- Consistent startup procedures
- Clear separation of concerns

## Script Locations

- `setup/entrypoint.sh`: Database initialization and migrations
- `redis/entrypoint.sh`: Redis server configuration and startup
- `hocuspocus/entrypoint.sh`: Hocuspocus service initialization
- `server/entrypoint.sh`: Main server startup and health checks

## Common Features

Each script includes:

1. Error handling with `set -e`
2. Timestamp-based logging
3. Health checks for dependencies
4. Environment-specific behavior (development/production)

## Service-Specific Details

### Setup Service
- Handles database creation
- Runs migrations
- Seeds initial data
- Waits for PostgreSQL to be ready

### Redis Service
- Creates runtime configuration
- Securely handles passwords from secrets
- Configures persistence and logging
- Sets up performance tuning

### Hocuspocus Service
- Checks PostgreSQL and Redis dependencies
- Handles development/production modes
- Provides health check endpoint
- Manages WebSocket connections

### Server Service
- Displays version information
- Checks all service dependencies
- Handles development/production modes
- Provides comprehensive logging

## Usage

The entrypoint scripts are automatically executed when their respective containers start. No manual intervention is required.

### Development Mode

```bash
docker-compose up
```

The scripts will:
1. Check dependencies
2. Initialize services
3. Start in development mode with hot reloading

### Production Mode

```bash
docker-compose -f docker-compose.yaml up
```

The scripts will:
1. Perform thorough health checks
2. Initialize with production settings
3. Start services with optimized configurations

## Error Handling

All scripts implement proper error handling:
- Descriptive error messages
- Non-zero exit codes on failure
- Dependency timeout handling
- Graceful shutdown procedures

## Logging

Consistent logging format across all scripts:
- Timestamp prefixes
- Service identification
- Status updates
- Error details when applicable

## Security

Security measures implemented:
- Secrets management
- No hardcoded credentials
- Proper file permissions
- Non-root user execution where applicable

## Maintenance

When updating the scripts:
1. Maintain the error handling patterns
2. Keep the logging format consistent
3. Update dependency checks as needed
4. Test both development and production modes
