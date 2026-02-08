# Complete Setup Guide - Windows

This guide provides step-by-step instructions for setting up the PSA system on Windows using Docker Compose from within Windows Subsystem for Linux (WSL).

> Note: The instructions below focus on the CE prebuilt images. Full EE setup guidance, including any edition-specific overrides, is being prepared and will be added soon.

## Prerequisites

- Windows 10/11 with [WSL](https://learn.microsoft.com/en-us/windows/wsl/install?WT.mc_id=310915) enabled (Ubuntu is recommended)
- [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) with the WSL 2 based engine
- Docker Compose v2.20.0 or later (bundled with Docker Desktop)
- Git (available inside your WSL distribution)
- Text editor for configuration files (e.g., `nano`, `vim`, VS Code Remote)

> Windows-specific: After installing Docker Desktop, open **Settings → General** and enable **Use the WSL 2 based engine**. Then go to **Settings → Resources → WSL Integration**, enable your Ubuntu distro, apply, and restart Docker Desktop. Restart Windows after the initial installations if prompted.

## Choose a Release

> Windows/WSL: Launch Windows Terminal, open your Ubuntu (WSL) shell, and ensure Docker Desktop is running before executing the commands below.

1. Visit the [GitHub releases](https://github.com/nine-minds/alga-psa/releases) page and note the exact release you want to run (example below uses `release/0.11.0`).
2. Clone and check out that release:
   ```bash
   git clone https://github.com/nine-minds/alga-psa.git
   cd alga-psa
   git checkout release/0.11.0
   ```
3. Pin the container image to the same release by running the helper script:
   ```bash
   ./scripts/set-image-tag.sh
   ```

## Initial Setup

1. Clone the repository (skip if already done above):
   ```bash
   git clone https://github.com/nine-minds/alga-psa.git
   cd alga-psa
   ```
2. Create the secrets directory:
   ```bash
   mkdir -p secrets
   ```

## Secrets Configuration

1. Create secret files in the `secrets/` directory (replace placeholders with strong values):

   Use single quotes around secret values to prevent shell expansion of special characters (for example `$`, `!`, `*`, and backticks).
   If a secret contains a single quote (`'`), use a quoted heredoc instead:
   ```bash
   cat > secrets/email_password <<'EOF'
   your-secret-value
   EOF
   ```

   Database secrets:
   ```bash
   echo 'your-secure-admin-password' > secrets/postgres_password
   echo 'your-secure-app-password' > secrets/db_password_server
   echo 'your-secure-hocuspocus-password' > secrets/db_password_hocuspocus
   ```

   Redis secret:
   ```bash
   echo 'your-secure-password' > secrets/redis_password
   ```

   Authentication secret:
   ```bash
   echo 'your-32-char-min-key' > secrets/alga_auth_key
   ```

   Security secrets:
   ```bash
   echo 'your-32-char-min-key' > secrets/crypto_key
   echo 'your-32-char-min-key' > secrets/token_secret_key
   echo 'your-32-char-min-key' > secrets/nextauth_secret
   ```

   Email & OAuth secrets:
   ```bash
   echo 'your-email-password' > secrets/email_password
   echo 'your-client-id' > secrets/google_oauth_client_id
   echo 'your-client-secret' > secrets/google_oauth_client_secret
   ```

2. Set proper permissions:
   ```bash
   chmod 600 secrets/*
   ```

## Environment Configuration

1. Copy the environment template:
   ```bash
   cp .env.example server/.env
   ```
2. Open `server/.env` in your editor and confirm these core settings (adjust as needed):
   - `DB_TYPE=postgres` (required)
   - `DB_USER_ADMIN=postgres`
   - `HOST=http://localhost:3000` (use your public domain in production)
   - `LOG_LEVEL=INFO`
   - `LOG_IS_FORMAT_JSON=false`
   - `LOG_IS_FULL_DETAILS=false`
   - `EMAIL_ENABLE=false` (set to `true` when you are ready to send mail)
   - `EMAIL_FROM=noreply@example.com`
   - `EMAIL_HOST=smtp.gmail.com`
   - `EMAIL_PORT=587`
   - `EMAIL_USERNAME=noreply@example.com`
   - `NEXTAUTH_URL=http://localhost:3000`
   - `NEXTAUTH_SESSION_EXPIRES=86400`

   Optional: enable collaborative editing by setting `REQUIRE_HOCUSPOCUS=true`.

> Note: The system performs validation of these environment variables at startup. Missing or invalid values will prevent the system from starting.

## Docker Compose Configuration

> All commands in this section assume you have run `./scripts/set-image-tag.sh` and that `.env.image` sits alongside `server/.env`. Always pass both env files so Compose pulls the correct prebuilt image.

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  --env-file server/.env --env-file .env.image up -d
```

> Note: The `-d` flag runs containers in detached/background mode. Remove the `-d` flag if you want to monitor the server output directly in the terminal.

### Initial Login Credentials

The first successful boot seeds a sample workspace admin account and prints its credentials to the server logs. Tail the logs right after the stack starts so you can copy the values for your first login:

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  --env-file server/.env --env-file .env.image logs -f
```

Look for a banner similar to the following (password redacted here for safety—yours will show the real value):

```
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: *******************************************************
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: ******** User Email is -> [ glinda@emeraldcity.oz ]  ********
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: ********       Password is -> [ ****REDACTED**** ]   ********
sebastian_server_ce  | 2025-02-10 15:12:23 [INFO   ]: *******************************************************
```

> Copy the credentials before stopping the logs. After you sign in, update the password for production use.

The CE stack now includes the `workflow-worker` service by default, giving you a production-like asynchronous processing setup without additional compose overrides. The `ALGA_IMAGE_TAG` value determines which prebuilt image is retrieved; compose does not fall back to `latest` unless you leave the variable unset.

## Production Setup (Persistent Storage)

For production-like deployments, persist both your database and uploaded documents to named Docker volumes. This keeps data safe across container restarts and image updates.

- Database volume: `postgres_data` (mounted at `/var/lib/postgresql/data`)
- Documents/files volume: `files_data` (mounted at `/data/files`)

The CE prebuilt compose now includes these volumes by default. When you run the compose command above, Docker will automatically create and attach them.

Recommended environment config for storage (add to `server/.env`):
```bash
STORAGE_DEFAULT_PROVIDER=local
STORAGE_LOCAL_BASE_PATH=/data/files
```

Verify volumes:
```bash
docker volume ls | grep -E "postgres_data|files_data"
```

### Network Exposure

The shared base compose file exposes Postgres, PgBouncer, Redis, and the application ports to the host for local convenience. For hardened environments, either remove or override the `ports:` entries with a compose override file, bind them to `127.0.0.1` behind a reverse proxy/firewall, or enforce host-level firewall rules that only allow trusted networks. Restart the stack after applying your chosen approach.

### Backups

- Postgres (logical backup using pg_dump — recommended). Replace the container name if you customized it.
  ```bash
  PGPASSWORD=$(cat secrets/postgres_password) \
  docker exec -e PGPASSWORD=${PGPASSWORD} $(docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image ps -q postgres) \
    pg_dump -U postgres -d server -Fc -f /tmp/pg_backup.dump
  docker cp $(docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image ps -q postgres):/tmp/pg_backup.dump ./pg_backup_$(date +%F).dump
  ```

- Postgres (quick snapshot of the data volume — use when DB is stopped):
  ```bash
  docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image stop server pgbouncer postgres
  docker run --rm -v <project>_postgres_data:/var/lib/postgresql/data -v "$PWD":/backup alpine \
    tar czf /backup/postgres_volume_$(date +%F).tar.gz -C /var/lib/postgresql/data .
  docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image start postgres pgbouncer server
  ```

- Files/documents volume:
  ```bash
  docker run --rm -v <project>_files_data:/data/files -v "$PWD":/backup alpine \
    tar czf /backup/files_volume_$(date +%F).tar.gz -C /data/files .
  ```

Note: Volume names are prefixed by your Compose project (e.g., `<project>_postgres_data`). If you customized `APP_NAME` or use `-p` with compose, check with `docker volume ls` and substitute accordingly.

### Restores (brief)

- Postgres (pg_restore). Create an empty database first if needed.
  ```bash
  PGPASSWORD=$(cat secrets/postgres_password) \
  docker cp ./pg_backup.dump $(docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image ps -q postgres):/tmp/pg_backup.dump
  docker exec -e PGPASSWORD=${PGPASSWORD} $(docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image ps -q postgres) \
    pg_restore -U postgres -d server --clean --if-exists /tmp/pg_backup.dump
  ```

- Files/documents volume:
  ```bash
  docker run --rm -v <project>_files_data:/data/files -v "$PWD":/backup alpine \
    sh -c "rm -rf /data/files/* && tar xzf /backup/files_volume.tgz -C /data/files"
  ```

### Notes

- The application’s local storage provider writes to `/data/files` inside the server container. Using the named volume `files_data` keeps those assets across restarts without host-permission tweaks.
- `docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image down` followed by `... up -d` is safe for restarts. Avoid adding `-v` unless you explicitly intend to wipe Postgres/files volumes.
- To inspect the volume contents from the host, use `docker run --rm -v <project>_postgres_data:/var/lib/postgresql/data busybox ls /var/lib/postgresql/data` (replace the volume name if you changed `APP_NAME` or pass `-p`).

## Monitoring

You can monitor the initialization process through Docker logs:
```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  --env-file server/.env --env-file .env.image logs -f
```

## Troubleshooting

### Postgres authentication loop
- Continuous `password authentication failed for user "postgres"` or `role "hocuspocus_user" does not exist` messages mean the secrets on disk no longer match the credentials stored inside the `postgres_data` volume.
- If you need to keep existing data, sync the passwords and recreate the missing role:
  ```bash
  docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
    --env-file server/.env --env-file .env.image exec postgres \
    psql -U postgres -c "ALTER ROLE postgres WITH PASSWORD '$(cat secrets/postgres_password)';"

  docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
    --env-file server/.env --env-file .env.image exec postgres \
    psql -U postgres -c "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hocuspocus_user') THEN CREATE ROLE hocuspocus_user LOGIN PASSWORD '$(cat secrets/db_password_hocuspocus)'; ELSE ALTER ROLE hocuspocus_user WITH PASSWORD '$(cat secrets/db_password_hocuspocus)'; END IF; END $$;" 
  ```
- To start fresh (wipes the database), stop the stack and remove the named volumes before bringing it back up:
  ```bash
  docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
    --env-file server/.env --env-file .env.image down -v
  docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
    --env-file server/.env --env-file .env.image up -d
  ```
- After credentials are in sync, the `setup` container will finish running and migrations plus seed data will be applied automatically.

## Verification

1. Check service health:
   ```bash
   docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
     --env-file server/.env --env-file .env.image ps
   ```
2. Access the application:
   - Development: http://localhost:3000
   - Production: https://your-domain.com
3. Verify logs for any errors:
   ```bash
   docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
     --env-file server/.env --env-file .env.image logs [service-name]
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

## Production/Public Deployment Configuration

When deploying for public access (not localhost), additional configuration is required:

### Authentication URL Configuration
The `NEXTAUTH_URL` environment variable must match your public domain:

For local development:
```bash
NEXTAUTH_URL=http://localhost:3000
```

For production deployment:
```bash
NEXTAUTH_URL=https://your-domain.com
HOST=https://your-domain.com
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
EMAIL_FROM=noreply@your-domain.com
EMAIL_HOST=your-smtp-server.com
EMAIL_USERNAME=noreply@your-domain.com
```

### Security Considerations
- Use strong, unique secrets (different from development)
- Ensure all secret files have proper permissions (600)
- Configure firewall rules appropriately
- Regular backup procedures
- Monitor access logs

## Upgrading

When upgrading from a previous version:

1. Backup all data:
   ```bash
   docker compose --env-file server/.env --env-file .env.image exec postgres \
     pg_dump -U postgres server > backup.sql
   ```
2. Update your checkout to the target release (e.g., `git fetch && git checkout release/0.11.0`).
3. Run `./scripts/set-image-tag.sh` again so `.env.image` updates to the new release tag or short commit.
4. Pull the new images and restart the stack:
   ```bash
   docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
     --env-file server/.env --env-file .env.image pull
   docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
     --env-file server/.env --env-file .env.image down
   docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
     --env-file server/.env --env-file .env.image up -d
   ```
5. Review changes in:
   - Docker Compose files
   - Environment variables
   - Secret requirements
   - Database schema
   - RLS policies
   - Protocol Buffer definitions (EE only)
6. Update configurations as needed and verify the application starts cleanly before removing the old backups.

## Additional Resources

- [Configuration Guide](configuration_guide.md)
- [Development Guide](development_guide.md)
- [Docker Compose Documentation](docker_compose.md)
- [Secrets Management](../security/secrets_management.md)
- [Entrypoint Scripts](entrypoint_scripts.md)
