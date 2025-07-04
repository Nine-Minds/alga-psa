# Complete Setup Guide

This guide provides step-by-step instructions for setting up the PSA system using Docker Compose, supporting both Community Edition (CE) and Enterprise Edition (EE).

## Prerequisites

- Docker Engine 24.0.0 or later
- Docker Compose v2.20.0 or later
- Git
- Text editor for configuration files

## Initial Setup

1. Clone the repository:
```bash
git clone https://github.com/nine-minds/alga-psa.git
cd alga-psa
```

2. Create required directories:
```bash
mkdir -p secrets
```

## Secrets Configuration

1. Create secret files in the `secrets/` directory:

Database Secrets:
```bash
# Admin user (postgres) - for database administration
echo "your-secure-admin-password" > secrets/postgres_password

# Application user (app_user) - for RLS-controlled access
echo "your-secure-app-password" > secrets/db_password_server

# Hocuspocus service
echo "your-secure-hocuspocus-password" > secrets/db_password_hocuspocus
```

Redis Secret:
```bash
echo "your-secure-password" > secrets/redis_password
```

Authentication Secret:
```bash
# Authentication key for password hashing
echo "your-32-char-min-key" > secrets/alga_auth_key
```

Security Secrets:
```bash
echo "your-32-char-min-key" > secrets/crypto_key
echo "your-32-char-min-key" > secrets/token_secret_key
echo "your-32-char-min-key" > secrets/nextauth_secret
```

Email & OAuth Secrets:
```bash
echo "your-email-password" > secrets/email_password
echo "your-client-id" > secrets/google_oauth_client_id
echo "your-client-secret" > secrets/google_oauth_client_secret
```

2. Set proper permissions:
```bash
chmod 600 secrets/*
```

## Environment Configuration

1. Copy the appropriate environment template:

```bash
cp .env.example server/.env
```

2. Edit the environment file and configure required values:

Required Variables:
```bash
# Database Configuration
DB_TYPE=postgres  # Must be "postgres"
DB_USER_ADMIN=postgres  # Admin user for database operations

# Logging Configuration
LOG_LEVEL=INFO  # One of: SYSTEM, TRACE, DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_IS_FORMAT_JSON=false
LOG_IS_FULL_DETAILS=false

# Email Configuration
EMAIL_ENABLE=false  # Set to "true" to enable email notifications
EMAIL_FROM=noreply@example.com  # Must be valid email
EMAIL_HOST=smtp.gmail.com  # SMTP server hostname
EMAIL_PORT=587  # SMTP port (587 for TLS, 465 for SSL)
EMAIL_USERNAME=noreply@example.com  # SMTP username

# Authentication Configuration
NEXTAUTH_URL=http://localhost:3000  # Must be valid URL - for production, use your public domain (e.g., https://your-domain.com)
NEXTAUTH_SESSION_EXPIRES=86400  # Must be > 0
```

Optional Variables:
```bash
# Hocuspocus Configuration
REQUIRE_HOCUSPOCUS=false  # Set to "true" to require hocuspocus service
```

Note: The system performs validation of these environment variables at startup. Missing or invalid values will prevent the system from starting.



## Docker Compose Configuration

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env up -d
```

> Note: The `-d` flag runs containers in detached/background mode. Remove the `-d` flag if you want to monitor the server output directly in the terminal.

## Service Initialization

The entrypoint scripts will automatically:
1. Validate environment variables
2. Check dependencies
3. Initialize database with both users
4. Set up RLS policies
5. Run database migrations
6. Seed initial data (in development)
7. Start services

You can monitor the initialization process through Docker logs:
```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env logs -f
```

## Initial Login Credentials

After successful initialization, the server logs will display a sample username and password that can be used for initial access:

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env logs -f
```

## Verification

1. Check service health:
```bash
docker compose ps
```

2. Access the application:
- Development: http://localhost:3000
- Production: https://your-domain.com

3. Verify logs for any errors:
```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env logs [service-name]
```

## Common Issues & Solutions

### Environment Validation Issues
- Check all required variables are set
- Verify DB_TYPE is set to "postgres"
- Ensure LOG_LEVEL is a valid value
- Verify email addresses are valid
- Check numeric values are > 0
- Verify URLs are valid

### Database Connection Issues
- Verify secret files exist and have correct permissions
- Check database host/port configuration
- Ensure PostgreSQL container is running
- Verify postgres_password for admin operations
- Verify db_password_server for application access
- Check RLS policies if access is denied

### Redis Connection Issues
- Verify redis_password secret exists
- Check redis host/port configuration
- Ensure Redis container is running

### Authentication Issues
- Verify alga_auth_key secret exists and is properly configured
- Ensure authentication key is at least 32 characters long
- Check permissions on alga_auth_key secret file

### Hocuspocus Issues
- Check REQUIRE_HOCUSPOCUS setting
- Verify service availability if required
- Check connection timeout settings
- Verify database access

### Service Startup Issues
- Check service logs for specific errors
- Verify all required secrets exist
- Ensure correct environment variables are set
- Verify database users and permissions

## Security Checklist

✓ All secrets created with secure values
✓ Secret files have restricted permissions (600)
✓ Environment files configured without sensitive data
✓ Production environment uses HTTPS
✓ Database passwords are strong and unique
✓ Redis password is configured
✓ Authentication key (alga_auth_key) is properly configured
✓ Encryption keys are at least 32 characters
✓ RLS policies properly configured
✓ Database users have appropriate permissions
✓ Environment variables properly validated

## Workflow System Configuration

The system includes a distributed workflow engine that can process business processes asynchronously across multiple servers.

### Enabling Distributed Workflow Processing

1. Configure workflow environment variables:
   ```bash
   # Workflow Configuration
   WORKFLOW_DISTRIBUTED_MODE=true  # Enable distributed mode
   WORKFLOW_REDIS_STREAM_PREFIX=workflow:events:  # Redis stream prefix
   WORKFLOW_REDIS_CONSUMER_GROUP=workflow-workers # Consumer group name
   WORKFLOW_REDIS_BATCH_SIZE=10    # Number of events to process in a batch
   WORKFLOW_REDIS_IDLE_TIMEOUT_MS=60000  # Idle timeout in milliseconds
   WORKFLOW_WORKER_REPLICAS=2      # Number of worker containers to run
   ```

2. Start the services with the workflow worker:
   ```bash
   docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env up -d
   ```

3. Verify the workflow worker is running:
   ```bash
   docker compose logs workflow-worker
   ```

4. Scale the number of worker instances if needed:
   ```bash
   docker compose up -d --scale workflow-worker=3
   ```

### Workflow System Architecture

The workflow system consists of:
- **Server**: Handles API requests and enqueues workflow events
- **Workflow Worker**: Processes workflow events asynchronously
- **Redis Streams**: Used as a message queue for distributing events
- **Database**: Stores workflow executions, events, and action results

In distributed mode, workflow events are:
1. Validated and persisted to the database
2. Published to Redis Streams
3. Processed asynchronously by worker processes

This architecture provides higher throughput, better fault tolerance, and improved scalability.

## Production/Public Deployment Configuration

When deploying for public access (not localhost), additional configuration is required:

### Authentication URL Configuration
The `NEXTAUTH_URL` environment variable must match your public domain:

```bash
# For local development
NEXTAUTH_URL=http://localhost:3000

# For production deployment
NEXTAUTH_URL=https://your-domain.com
```

### SSL/TLS Configuration
For production deployments:
1. Ensure your domain has valid SSL certificates
2. Configure your reverse proxy (nginx, Apache, etc.) for HTTPS
3. Update `NEXTAUTH_URL` to use `https://` protocol
4. Verify OAuth providers (if used) allow your production domain

### Email Configuration for Production
Update email settings for production notifications:
```bash
EMAIL_ENABLE=true
EMAIL_FROM=noreply@your-domain.com  # Use your domain
EMAIL_HOST=your-smtp-server.com
EMAIL_USERNAME=noreply@your-domain.com
```

### Security Considerations
- Use strong, unique secrets (different from development)
- Ensure all secret files have proper permissions (600)
- Configure firewall rules appropriately
- Regular backup procedures
- Monitor access logs

## Next Steps

1. Configure email notifications:
   - Set environment variables:
     ```bash
     EMAIL_ENABLE=true
     EMAIL_HOST=smtp.example.com
     EMAIL_PORT=587  # or 465 for SSL
     EMAIL_USERNAME=noreply@example.com
     EMAIL_PASSWORD=your-secure-password
     EMAIL_FROM=noreply@example.com
     ```
   - Features available after setup:
     * System-wide default templates
     * Tenant-specific template customization
     * User notification preferences
     * Rate limiting and audit logging
     * Categories: Tickets, Invoices, Projects, Time Entries
2. Set up OAuth if using Google authentication
3. Configure SSL/TLS for production
4. Set up backup procedures
5. Configure monitoring and logging
6. Review security settings
7. Review and test RLS policies

## Upgrading

When upgrading from a previous version:

1. Backup all data:
```bash
docker compose exec postgres pg_dump -U postgres server > backup.sql
```

2. Update prebuilt images and restart services:
```bash
docker compose pull
docker compose down
docker compose up -d
```

3. Review changes in:
- Docker Compose files
- Environment variables
- Secret requirements
- Database schema
- RLS policies
- Protocol Buffer definitions (EE only)

4. Update configurations as needed

5. Restart services:
```bash
docker compose down
docker compose up -d
```

## Additional Resources

- [Configuration Guide](configuration_guide.md)
- [Development Guide](development_guide.md)
- [Docker Compose Documentation](docker_compose.md)
- [Secrets Management](secrets_management.md)
- [Entrypoint Scripts](entrypoint_scripts.md)
