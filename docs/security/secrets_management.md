# Secrets Management

This document outlines how sensitive data is managed in the application using Docker secrets.

## Overview

Instead of storing sensitive data in environment variables or configuration files, we use Docker secrets to securely manage sensitive information. This approach provides several benefits:

- Secrets are stored securely on disk
- Secrets are only mounted in containers that need them
- Secrets are never exposed in container inspection or logs
- Secrets are mounted as files, providing a consistent interface across services

## Secret Files

All secrets are stored in the `secrets/` directory at the project root. Each secret is stored in its own file:

### Database Secrets
- `postgres_password` - PostgreSQL admin password (used by 'postgres' user for administration)
- `db_password_server` - Application user password (used by 'app_user' for RLS-controlled access)
- `db_password_hocuspocus` - Hocuspocus service password

### Redis Secrets
- `redis_password` - Redis password

### Email Secrets
- `email_password` - SMTP server password

### Security Secrets
- `crypto_key` - Encryption key for sensitive data
- `token_secret_key` - JWT signing key
- `nextauth_secret` - NextAuth.js secret key

### OAuth Secrets
- `google_oauth_client_id` - Google OAuth client ID
- `google_oauth_client_secret` - Google OAuth client secret

## Usage in Docker Compose

Secrets are defined in the `docker-compose.yaml` file under the `secrets` section and mounted to services that need them. For example:

```yaml
secrets:
  postgres_password:
    file: ./secrets/postgres_password
  db_password_server:
    file: ./secrets/db_password_server

services:
  postgres:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password

  server:
    environment:
      DB_USER_SERVER: app_user
    volumes:
      - type: bind
        source: ./secrets/db_password_server
        target: /run/secrets/db_password_server
        read_only: true
```

## Accessing Secrets in Containers

Secrets are mounted at `/run/secrets/<secret_name>` inside containers. Services should read secrets from these mounted files rather than environment variables.

Example of reading a secret in Node.js:
```javascript
const fs = require('fs');
const dbPassword = fs.readFileSync('/run/secrets/db_password_server', 'utf8').trim();
```

## Database Authentication

The system uses a two-user database authentication model for security:

1. Admin User (postgres):
   - Username: postgres
   - Password: Stored in postgres_password secret
   - Used for:
     * Database administration
     * Setup and migrations
     * Schema changes
     * Full database access

2. Application User (app_user):
   - Username: app_user
   - Password: Stored in db_password_server secret
   - Used for:
     * Application database access
     * Limited access via RLS policies
     * Regular database operations
   - Security:
     * Access controlled by Row Level Security (RLS)
     * Cannot modify schema or bypass RLS

## Security Considerations

1. Never commit secret files to version control
2. Add secret files to .gitignore
3. Use different secrets for different environments
4. Rotate secrets periodically
5. Limit secret access to only the services that need them
6. Use strong, unique passwords for each secret
7. Ensure proper file permissions on secret files
8. Follow principle of least privilege:
   - Use app_user for application access
   - Reserve postgres user for administration only

## Setting Up Secrets

1. Create the `secrets/` directory
2. Create individual files for each secret:
```bash
# Database
echo "your-secure-admin-password" > secrets/postgres_password
echo "your-secure-app-password" > secrets/db_password_server
echo "your-secure-hocuspocus-password" > secrets/db_password_hocuspocus

# Redis
echo "your-secure-password" > secrets/redis_password

# Security
echo "your-32-char-min-key" > secrets/crypto_key
echo "your-32-char-min-key" > secrets/token_secret_key
echo "your-32-char-min-key" > secrets/nextauth_secret

# Email & OAuth
echo "your-email-password" > secrets/email_password
echo "your-client-id" > secrets/google_oauth_client_id
echo "your-client-secret" > secrets/google_oauth_client_secret
```

3. Set appropriate permissions:
```bash
chmod 600 secrets/*
```

4. Update docker-compose files to use secrets
5. Update application code to read from secret files

## Environment Variables

The `.env.example` file indicates which values are managed via Docker secrets. When setting up a new environment:

1. Copy `.env.example` to `.env`
2. Fill in non-sensitive values in `.env`
3. Create corresponding secret files for sensitive values

## Best Practices

1. Always use secrets for sensitive data, never environment variables
2. Read secrets from files at runtime, not during build
3. Use consistent naming across all components
4. Document any changes to secret management
5. Keep secret files secure and backed up
6. Implement proper secret rotation procedures
7. Monitor secret usage and access patterns
8. Follow the principle of least privilege:
   - Use app_user for normal operations
   - Limit postgres user access to administration
   - Implement proper RLS policies
