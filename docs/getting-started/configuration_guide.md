# Configuration Guide

This guide explains the configuration system used in the PSA platform, covering environment variables, secrets management, and Docker Compose configuration.

## Configuration Structure

The configuration system is organized into three main components:

1. Environment Variables (non-sensitive settings)
2. Docker Secrets (sensitive data)
3. Docker Compose Files (service configuration)

## Environment Variables

### File Structure

- `.env.example`: Template with all available variables
- `.env.development`: Development environment defaults
- `.env.production`: Production environment defaults

### Variable Categories

#### Application Settings (APP_*)
```
APP_NAME=PSA Platform
APP_ENV=development|production
APP_VERSION=1.0.0
APP_HOST=localhost
APP_PORT=3000
APP_EDITION=community|enterprise
APP_VERIFY_EMAIL=false
```

#### Database Settings (DB_*)
```
DB_TYPE=postgres  # Required: Must be "postgres"
DB_HOST=postgres
DB_PORT=5432
DB_NAME=server
DB_NAME_SERVER=server
DB_USER_ADMIN=postgres  # Required: Admin user for database operations
DB_USER_SERVER=app_user
DB_USER_HOCUSPOCUS=app_user
# DB_PASSWORD_ADMIN managed via Docker secrets
# DB_PASSWORD_SERVER managed via Docker secrets
# DB_PASSWORD_SUPERUSER managed via Docker secrets
```

#### Redis Settings (REDIS_*)
```
REDIS_HOST=redis
REDIS_PORT=6379
# REDIS_PASSWORD managed via Docker secrets
```

#### Logging Settings (LOG_*)
```
LOG_LEVEL=INFO  # Required: One of 'SYSTEM'|'TRACE'|'DEBUG'|'INFO'|'WARNING'|'ERROR'|'CRITICAL'
LOG_IS_FORMAT_JSON=false  # Required: Boolean
LOG_IS_FULL_DETAILS=false  # Required: Boolean
LOG_ENABLED_FILE_LOGGING=false
LOG_DIR_PATH=/path/to/logs
LOG_ENABLED_EXTERNAL_LOGGING=false
LOG_EXTERNAL_HTTP_HOST=
LOG_EXTERNAL_HTTP_PORT=
LOG_EXTERNAL_HTTP_PATH=
LOG_EXTERNAL_HTTP_LEVEL=
LOG_EXTERNAL_HTTP_TOKEN=
```

#### Email Settings (EMAIL_*)
```
EMAIL_ENABLE=false  # Required: Boolean
EMAIL_FROM=noreply@example.com  # Required: Valid email address
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587  # Required: Number greater than 0
EMAIL_USERNAME=noreply@example.com  # Required: Valid email address
# EMAIL_PASSWORD managed via Docker secrets
```

#### Authentication Settings (NEXTAUTH_*)
```
NEXTAUTH_URL=http://localhost:3000  # Required: Valid URL - for production, must match your public domain
NEXTAUTH_SESSION_EXPIRES=86400  # Required: Number greater than 0
# NEXTAUTH_SECRET managed via Docker secrets
```

**Important**: For production deployments, `NEXTAUTH_URL` must match your actual public domain:
- Development: `http://localhost:3000`
- Production: `https://your-domain.com`

#### Crypto Settings (CRYPTO_*)
```
CRYPTO_SALT_BYTES=16
CRYPTO_ITERATION=100000
CRYPTO_KEY_LENGTH=64
CRYPTO_ALGORITHM=aes-256-gcm
# CRYPTO_KEY managed via Docker secrets
```

#### Hocuspocus Settings
```
HOCUSPOCUS_PORT=1234
HOCUSPOCUS_URL=ws://localhost:1234
REQUIRE_HOCUSPOCUS=false  # Optional: Set to "true" to require hocuspocus
```

## Docker Secrets

### Secret Files

All sensitive data is stored in individual files in the `secrets/` directory:

```
secrets/
├── db_password_server
├── db_password_hocuspocus
├── postgres_password
├── db_password_admin
├── db_password_superuser
├── redis_password
├── email_password
├── crypto_key
├── token_secret_key
├── nextauth_secret
├── google_oauth_client_id
└── google_oauth_client_secret
```

### Secret Management

1. Create secret files with secure values
2. Set proper permissions (chmod 600)
3. Never commit secrets to version control
4. Use different secrets per environment
5. Rotate secrets periodically

### Accessing Secrets

Secrets are mounted at `/run/secrets/<secret_name>` in containers:

```javascript
// Example of reading a secret in Node.js
const fs = require('fs');
const dbPassword = fs.readFileSync('/run/secrets/db_password_server', 'utf8');
```

## Docker Compose Configuration

### File Structure

```
docker-compose.base.yaml    # Base configuration
docker-compose.ce.yaml      # Community Edition config
docker-compose.ee.yaml      # Enterprise Edition config
docker-compose.prod.yaml    # Production overrides
```

### Base Configuration (docker-compose.base.yaml)

Contains:
- Common service definitions
- Shared network configuration
- Volume definitions
- Secret declarations
- Environment variable anchors

### Edition-Specific Configuration

#### Community Edition (docker-compose.ce.yaml)
- Extends base services
- Sets CE-specific paths
- Configures standard features

#### Enterprise Edition (docker-compose.ee.yaml)
- Extends base services
- Sets EE-specific paths
- Adds enterprise features
- Configures advanced settings

### Production Overrides (docker-compose.prod.yaml)

Additional settings for production:
- Resource limits
- Restart policies
- Logging configuration
- Health check settings

## Service-Specific Configuration

### PostgreSQL
- Database initialization
- User creation
- Permission settings
- Performance tuning

### Redis
- Persistence configuration
- Memory settings
- Security options
- Backup configuration

### Hocuspocus
- WebSocket settings
- Authentication
- Collaboration features
- Performance options
- Optional dependency (controlled by REQUIRE_HOCUSPOCUS)

### Main Server
- API configuration
- File storage settings
- Session management
- Security options
- Environment validation

## Configuration Best Practices

1. **Environment Variables**
   - Use clear, descriptive names
   - Group related variables
   - Document all options
   - Set sensible defaults
   - Validate required variables

2. **Secrets**
   - Use strong, unique values
   - Rotate regularly
   - Limit access scope
   - Monitor usage

3. **Docker Compose**
   - Keep configurations DRY
   - Use YAML anchors
   - Document overrides
   - Test all combinations

4. **Security**
   - Encrypt sensitive data
   - Use least privilege
   - Implement access controls
   - Regular security audits

## Validation and Testing

### Environment Variables
```bash
# Validate environment file
./scripts/validate-env.sh

# Test configuration
./scripts/test-config.sh
```

### Secrets
```bash
# Verify secret files
./scripts/check-secrets.sh

# Test secret access
./scripts/test-secrets.sh
```

### Docker Compose
```bash
# Validate compose files
docker compose config

# Test configurations
./scripts/test-compose.sh
```

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   - Check .env file exists
   - Verify variable names
   - Compare with .env.example
   - Check validation rules:
     - DB_TYPE must be "postgres"
     - LOG_LEVEL must be valid enum value
     - EMAIL_PORT must be > 0
     - Email addresses must be valid
     - URLs must be valid

2. **Secret Access Problems**
   - Verify file permissions
   - Check file existence
   - Validate secret content
   - Check secret paths in Docker Compose

3. **Compose Configuration Errors**
   - Validate YAML syntax
   - Check service names
   - Verify file paths
   - Check service dependencies

4. **Hocuspocus Issues**
   - Check REQUIRE_HOCUSPOCUS setting
   - Verify service availability
   - Check connection timeout settings
   - Validate WebSocket configuration

### Debug Tools

```bash
# Check environment
docker compose config

# Verify secrets
ls -l secrets/

# Test service config
docker compose up <service> --build

# Check service logs
docker compose logs <service>
```

## Maintenance

1. Regular tasks:
   - Rotate secrets
   - Update configurations
   - Review settings
   - Audit access
   - Validate environment variables

2. Updates:
   - Check for changes
   - Test new configs
   - Update documentation
   - Communicate changes
   - Verify validation rules

## Additional Resources

- [Setup Guide](setup_guide.md)
- [Development Guide](development_guide.md)
- [Docker Compose Docs](docker_compose.md)
- [Secrets Management](secrets_management.md)
