# Complete Setup Guide

[Previous content remains the same until Docker Compose Configuration section]

## Docker Compose Configuration

### Community Edition (CE)

1. For development:
```bash
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up
```

2. For production:
```bash
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml -f docker-compose.prod.yaml up -d
```

### Enterprise Edition (EE)

1. For development:
```bash
docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml up
```

2. For production:
```bash
docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml -f docker-compose.prod.yaml up -d
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
✓ Encryption keys are at least 32 characters
✓ RLS policies properly configured
✓ Database users have appropriate permissions
✓ Environment variables properly validated

## Next Steps

1. Configure email settings for notifications
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

2. Update the repository:
```bash
git pull origin main
```

3. Review changes in:
- Docker Compose files
- Environment variables
- Secret requirements
- Database schema
- RLS policies
- Protocol Buffer definitions (EE only)

4. Update configurations as needed

5. Rebuild and restart:
```bash
docker compose down
docker compose up -d --build
```

## Additional Resources

- [Configuration Guide](configuration_guide.md)
- [Development Guide](development_guide.md)
- [Docker Compose Documentation](docker_compose.md)
- [Secrets Management](secrets_management.md)
- [Entrypoint Scripts](entrypoint_scripts.md)
