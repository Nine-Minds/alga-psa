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

1. Clone the repository:
   ```bash
   git clone https://github.com/nine-minds/alga-psa.git
   cd alga-psa
   ```
2. Fetch the latest remote refs and list release branches sorted by version:
   ```bash
   git fetch origin --prune
   git branch -r --list 'origin/release/*' --sort='version:refname'
   ```
3. Release branches follow the `release/<version>` pattern, including release candidates such as `release/1.0-rc3`. If you want the newest release branch, use the last entry from the command output above.
4. Check out the release branch you want to run:
   ```bash
   git checkout <release-branch>
   ```
5. Pin the container image to the same release by running the helper script:
   ```bash
   ./scripts/set-image-tag.sh
   ```

## Initial Setup

1. Create the secrets directory:
   ```bash
   mkdir -p secrets
   ```

## Secrets Configuration

1. Create secret files in the `secrets/` directory (replace placeholders with strong values):

   If you are using Git Bash or WSL, the idempotent bootstrap script generates
   every required secret on a fresh checkout (including `credential_encryption_key`,
   the EE credentials-vault encryption key); on an existing install it preserves
   established values, adds only the new key, and fails loudly rather than
   regenerating other missing secrets. It never overwrites existing files:
   ```bash
   ./scripts/generate-secrets.sh
   ```
   The manual steps below remain for operators who want to pin specific values.

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
   echo "$(openssl rand -base64 32)" > secrets/credential_encryption_key
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
   - `NEXT_PUBLIC_BASE_URL=http://localhost:3000` (required; use your public URL in production)
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

By default the stack publishes only `server` (port 3000) and `hocuspocus` (port 1234) on the host. Your reverse proxy needs those two. Postgres, PgBouncer, and Redis are reachable only on the Compose network, so the other containers use them and nothing outside Docker can.

Do not rely on a host firewall to protect a published port. Docker adds its own rules for published ports, and those rules are evaluated before ufw and firewalld on Linux hosts. Not publishing the port at all is the safe default.

#### Host access on the same machine

To reach Postgres, PgBouncer, or Redis from tools on your Windows machine or inside WSL, add `docker-compose.expose-infra.yaml` as the **last** `-f` file. It binds the three services to `127.0.0.1`:

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  -f docker-compose.expose-infra.yaml \
  --env-file server/.env --env-file .env.image up -d
```

Check the result:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}'
```

You should see `127.0.0.1:5432->5432/tcp`, `127.0.0.1:6432->6432/tcp`, and `127.0.0.1:6379->6379/tcp`. On Docker Desktop, `127.0.0.1` bindings are reachable from Windows and from WSL. Use `127.0.0.1` rather than `localhost` in connection strings. Some clients try the IPv6 address `::1` first, and the loopback binding is IPv4 only.

The overlay uses the host ports from `EXPOSE_DB_PORT` (5432), `EXPOSE_PGBOUNCER_PORT` (6432), and `EXPOSE_REDIS_PORT` (6379). Set them in your environment file if those ports are taken.

#### Remote access

Use an SSH tunnel to the loopback port. Nothing else needs to listen on a network interface:

```bash
ssh -L 5432:127.0.0.1:5432 user@your-docker-host
psql -h 127.0.0.1 -p 5432 -U postgres server
```

If a tool cannot use a tunnel, set `EXPOSE_INFRA_BIND_ADDR` to the address of one private or VPN interface on the Docker host.

> **Never set `EXPOSE_INFRA_BIND_ADDR=0.0.0.0`.** It publishes the database and cache on every network the host is connected to. `EXPOSE_INFRA_BIND_ADDR` applies only to Postgres, PgBouncer, and Redis. It does not change the `server` or `hocuspocus` ports.

#### Changing published ports in your own override file

Override files and `extends` add to a service's `ports:` list. They never replace it. To remove a published port or replace the list, use `!reset` or `!override`. Both need Docker Compose 2.24 or later:

```yaml
# docker-compose.local.yaml
services:
  hocuspocus:
    ports: !reset []          # publish nothing
  server:
    ports: !override          # replace the list
      - "127.0.0.1:3000:3000"
```

Add your file after the other `-f` files, and keep `docker-compose.expose-infra.yaml` last if you use it.

The source-built production overlay, `docker-compose.prod.yaml`, uses `!reset` to publish no database or cache ports. It requires Compose 2.24 or later. The prebuilt files do not use `!reset`, so the v2.20 minimum above still applies to them.

#### Maintenance without host ports

Database maintenance does not need host ports. `docker compose exec postgres psql -U postgres server` opens a shell in the database container, and the backup commands below use `docker exec`.

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
✓ `pg_hba.conf` has no `trust` entries
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
NEXT_PUBLIC_BASE_URL=https://your-domain.com
HOST=https://your-domain.com
```

`NEXT_PUBLIC_BASE_URL` is required by the prebuilt Compose stack. Marketing
emails use it for recipient-facing unsubscribe, click-tracking, and open-tracking
links. Set it to an origin that email recipients can reach.

### SSL/TLS Configuration
For production deployments:
1. Ensure your domain has valid SSL certificates
2. Configure your reverse proxy (nginx, Apache, etc.) for HTTPS
3. Update `NEXTAUTH_URL` and `NEXT_PUBLIC_BASE_URL` to use the same public `https://` origin
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
2. Fetch the latest release branches, choose the target `release/*` branch, and check it out:
   ```bash
   git fetch origin --prune
   git branch -r --list 'origin/release/*' --sort='version:refname'
   git checkout <release-branch>
   ```
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
   Postgres, PgBouncer, and Redis no longer publish host ports, so Compose recreates those containers on restart. The data in `postgres_data` is not affected. If something on Windows or in WSL connects to `localhost:5432`, `6432`, or `6379`, add `-f docker-compose.expose-infra.yaml` as the last file. See [Network Exposure](#network-exposure).
5. Review changes in:
   - Docker Compose files
   - Environment variables
   - Secret requirements
   - Database schema
   - RLS policies
   - Protocol Buffer definitions (EE only)
6. Update configurations as needed and verify the application starts cleanly before removing the old backups.

### Postgres authentication (upgrading from v1.6.0 or earlier)

Postgres now requires a password for every network connection. Earlier releases could create the `postgres_data` volume with legacy `trust` entries in `pg_hba.conf`. Those entries accepted connections without a password.

Fresh installs need no action. On an existing install, the first `up` after the upgrade repairs the volume before Postgres starts listening:

- The `postgres` container rewrites every `trust` entry in `pg_hba.conf` to `md5`.
- It sets the `postgres` role's password to the value in `secrets/postgres_password`. Components of the stack already use that secret, so they keep working.
- It saves the original file as `$PGDATA/pg_hba.conf.pre-trust-removal` (mode 600).
- It leaves the `app_user` and `hocuspocus_user` passwords alone. The `setup` container applies them from their secrets on every run.

Look for this line in the `postgres` logs:

```text
alga-postgres: Repaired legacy trust rules in /var/lib/postgresql/data/pg_hba.conf (now md5); superuser 'postgres' password synced to the configured secret; original saved to ...
```

To check the result, list the active rules. None of them should end in `trust`:

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  --env-file server/.env --env-file .env.image exec postgres \
  sh -c 'grep -v "^#" "$PGDATA/pg_hba.conf" | grep -v "^$"'
```

If you run Postgres outside these compose files, make the same change by hand. Set every `trust` method in `pg_hba.conf` to `md5`, make sure each login role has a password, then run `SELECT pg_reload_conf();`.

The stack refuses to start in three cases:

- `POSTGRES_HOST_AUTH_METHOD=trust is not allowed`: the postgres container found that environment value. Remove it or set it to `md5`.
- `no postgres password is available`: the volume still has legacy entries, and `secrets/postgres_password` is empty or missing. Restore the secret and start again.
- `pg_hba.conf has rules that do not require a password`: `setup` found a rule without a password after Postgres started. Recreate the `postgres` container so it repairs the file, or fix the rule by hand as described above.

## Additional Resources

- [Configuration Guide](configuration_guide.md)
- [Development Guide](development_guide.md)
- [Docker Compose Documentation](docker_compose.md)
- [Secrets Management](../security/secrets_management.md)
- [Entrypoint Scripts](entrypoint_scripts.md)
