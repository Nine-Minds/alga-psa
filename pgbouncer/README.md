# PgBouncer Configuration

This directory contains the PgBouncer connection pooler configuration for the Alga PSA application.

## Components

- `Dockerfile`: Builds the PgBouncer container
- `entrypoint.sh`: Initializes PgBouncer with secrets and configuration
- `pgbouncer.ini.template`: PgBouncer configuration template
- `userlist.txt.template`: User authentication template

## Secrets Management

PgBouncer requires the following secrets to be present:
- `/run/secrets/postgres_password`: PostgreSQL superuser password
- `/run/secrets/db_password_server`: Application database user password

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
     -v $(pwd)/secrets/postgres_password:/run/secrets/postgres_password:ro \
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