# PgBouncer Configuration

This directory contains the PgBouncer connection pooler configuration for the AlgaPSA application.

## Components

- `Dockerfile`: Builds the PgBouncer container
- `entrypoint.sh`: Initializes PgBouncer with secrets and configuration
- `pgbouncer.ini.template`: PgBouncer configuration template

## Authentication

PgBouncer requires a password for every client connection (`auth_type = md5`).
Compose stores md5 password verifiers in Postgres (`password_encryption=md5`),
and the PgBouncer userlist is derived from the same secrets each time the
container starts.

- Leading and trailing whitespace (including `\r`) is trimmed from secret files,
  the same way the application reads them.
- The container refuses to start if a secret is empty, or if the rendered
  configuration sets `auth_type` to anything other than `md5` or `scram-sha-256`.
- Rotating a secret requires restarting (and, since the image is built locally,
  rebuilding with `docker compose ... up -d --build`) the `pgbouncer` service.
- External tools must authenticate with the `app_user` password from
  `secrets/db_password_server`. Only `app_user` and the `server` database are
  available through PgBouncer; use a direct Postgres connection for administration.

## Secrets Management

PgBouncer requires the following secret to be present:
- `/run/secrets/db_password_server`: Application database user (`app_user`) password

The PostgreSQL superuser is not served through PgBouncer and its password is not
mounted into this container. Administration and migrations connect to Postgres
directly (`DB_HOST_ADMIN` / `DB_PORT_ADMIN`).

### Important: Secret File Format

Secret files must be properly formatted:
- Should contain the password as a single line
- Should have a trailing newline character
- Should not contain extra whitespace

### Troubleshooting

If PgBouncer container exits silently:

1. Check if secrets are mounted:
   ```bash
   docker compose run --rm pgbouncer ls -la /run/secrets/
   ```

2. Validate secret files:
   ```bash
   ./scripts/validate-secrets.sh
   ```

3. Check container logs:
   ```bash
   docker logs <container_name>
   ```

4. Test entrypoint directly:
   ```bash
   docker run --rm \
     -v $(pwd)/secrets/db_password_server:/run/secrets/db_password_server:ro \
     --entrypoint /bin/sh \
     alga-psa-pgbouncer -c "sh -x /entrypoint.sh"
   ```

## Known Issues

### Silent Failures with `read` Command
The shell `read` command fails silently if the input file doesn't end with a newline.
We use `$(cat file)` instead of `read < file` to handle files without trailing newlines.

## Configuration

PgBouncer is configured to:
- Listen on port 6432
- Use transaction pooling mode
- Support up to 1000 client connections
- Maintain a pool of 20 connections per database