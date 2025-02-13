# Complete Setup Guide - Windows

This guide provides step-by-step instructions for setting up the PSA system using Docker and Windows Subsystem for Linux.

## Prerequisites

Install components in order:
- [WSL](https://learn.microsoft.com/en-us/windows/wsl/install?WT.mc_id=310915)
- [Docker for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)

 Restart your system before continuing.

## Docker Configuration

1. Open Docker and go to Settings --> General --> Toggle `Use the WSL 2 based engine` to ON
2. Go to Resources --> WSL integration --> Toggle `Ubuntu` to ON
3. Apply and restart

## Server Setup

1. Open Windows Terminal, select the dropdown at the top, and start a new Ubuntu console (the round logo)
2. Set the username/password until you are presented with ``USERNAME@COMPUTERNAME:~$`` in the console
3. Create an AlgaPSA Directory:
``mkdir algapsa``
4. Change to the new directory: ``cd algapsa``
5. Clone the repository:
```bash
git clone https://github.com/nine-minds/alga-psa.git
```
5. Change your console location to the cloned directory:
```bash
cd alga-psa
```
6. Make the secrets directory:
```bash
mkdir -p secrets
```
7. Create your secrets by pasting the entire codeblock into the console:

> [!WARNING]
> The provided strings are examples only! It is highly recommended you change them for your own deployment!
```bash
echo pEVhcMWeq5RTL2US > secrets/postgres_password
echo brCKSMZW798eGcLt > secrets/db_password_server
echo XKrQauZTVRfFH87j > secrets/db_password_hocuspocus
echo H59BszmU8wFYnKQx > secrets/redis_password
echo n3h8uCc6yNm9SrHBeD2JVdYKfxtpkZv3 > secrets/alga_auth_key
echo KGn4swfUBS6jxt9Rhdkp8qeX73TEQNbR > secrets/crypto_key
echo ENZrjMqJXsUPYKfxh6uBkDCv4np3ma9S > secrets/token_secret_key
echo yWVM6ANsD42Pv79GxpECHkZKzXh8mrSr > secrets/nextauth_secret
echo dmfxBhp9NAQG4zF8SPLJ7UMWR5rCbtjh > secrets/email_password
echo ZkX6aHPK2nsJtLdMSxzUgvmcV9Qu5yBw > secrets/google_oauth_client_id
echo yYtgSsfVPXTcRM5GDnaKvAuzF3N4pbHj > secrets/google_oauth_client_secret
```
7. Set permissions on the secrets folder
```bash
chmod 600 secrets/*
```

## Environment Configuration

1. Copy the appropriate environment template:

```bash
cp .env.example server/.env
```

2. Edit the environment file and configure required values:

> [!NOTE]
> The default config file you just copied will work as-is, change the below values if you need to.

To edit file, enter the below into console:
```bash
nano server/.env
```

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
NEXTAUTH_URL=http://localhost:3000  # Must be valid URL
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
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml up --env-file server/.env -d
```
This will build, deploy, and start the server which you can get to at http://localhost:3000

## Initial Login Credentials

After successful initialization, the server logs will display a sample username and password that can be used for initial access:

```bash
docker compose logs -f
```

> Note: The `-d` flag runs containers in detached/background mode. Remove the `-d` flag if you want to monitor the server output directly in the terminal.

Look for:

```bash
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: *************************************************************
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: ********                                             ********
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: ******** User Email is -> [ glinda@emeraldcity.oz ]  ********
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: ********                                             ********
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: ********       Password is -> [ ****REDACTED**** ]   ********
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: ********                                             ********
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: *************************************************************
```

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
docker compose logs -f
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
docker compose logs [service-name]
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

## Additional Resources

- [Configuration Guide](configuration_guide.md)
- [Development Guide](development_guide.md)
- [Docker Compose Documentation](docker_compose.md)
- [Secrets Management](secrets_management.md)
- [Entrypoint Scripts](entrypoint_scripts.md)
