# Docker Compose Structure

The Docker Compose configuration has been organized into multiple files to support both Community Edition (CE) and Enterprise Edition (EE) while following best practices and eliminating duplication.

## File Structure

- `docker-compose.base.yaml`: Contains shared service definitions for postgres, pgbouncer and redis
- `docker-compose.ce.yaml`: Community Edition specific configurations
- `docker-compose.ee.yaml`: Enterprise Edition specific configurations
- `docker-compose.prod.yaml`: Production overlay for the source-built stacks
- `docker-compose.expose-infra.yaml`: Opt-in overlay that publishes postgres, pgbouncer and redis on the host

## Base Configuration

The base configuration (`docker-compose.base.yaml`) includes:
- Core service definitions for postgres and redis
- Shared network configuration
- Secret definitions

## Edition-Specific Configurations

### Community Edition (CE)
The CE configuration (`docker-compose.ce.yaml`) includes:
- Standard service configurations
- The shared `Dockerfile.dev` development image with Community Edition enabled
- Default community settings
- Service environment variables
- Named volumes for PostgreSQL data and application files
- Network and dependency configurations

The `postgres_data` and `files_data` volumes retain database records and application files across ordinary `docker compose down` and `up` commands. Running `docker compose down -v` explicitly removes these volumes and their data.

### Enterprise Edition (EE)
The EE configuration (`docker-compose.ee.yaml`) includes:
- Enterprise-specific database setup
- EE-specific Dockerfile paths
- Additional enterprise features and settings
- Service environment variables
- Network and dependency configurations

## Usage

### Running Community Edition

```bash
# Development
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml up

# Production
docker compose -f docker-compose.base.yaml -f docker-compose.ce.yaml -f docker-compose.prod.yaml up -d
```

### Running Enterprise Edition

```bash
# Development
docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml up

# Production
docker compose -f docker-compose.base.yaml -f docker-compose.ee.yaml -f docker-compose.prod.yaml up -d
```

## Published Ports for Postgres, PgBouncer and Redis

Compose appends to `ports:` when you combine files or use `extends`. It never replaces the list. For that reason the shared definitions publish nothing, and each stack adds the ports it needs:

| Stack | Postgres, PgBouncer, Redis on the host |
|---|---|
| Prebuilt CE/EE (`docker-compose.prebuilt.*.yaml`) | Not published |
| Source-built with `docker-compose.prod.yaml` | Not published |
| Source-built dev (`base` + `ce` or `ee`, with or without `docker-compose.yaml`) | `127.0.0.1` only |
| Test stacks (`docker-compose.e2e*.yaml`, `docker-compose.playwright-*.yaml`, and similar) | `127.0.0.1` only |

`EXPOSE_INFRA_BIND_ADDR` sets the address the dev and test stacks, and `docker-compose.expose-infra.yaml`, bind to. It defaults to `127.0.0.1`. It applies only to postgres, pgbouncer, redis and `ai-gateway-postgres`. Use a single private or VPN interface address if another machine must connect. Do not use `0.0.0.0`. The host port numbers come from `EXPOSE_DB_PORT`, `EXPOSE_PGBOUNCER_PORT`, `EXPOSE_REDIS_PORT` and `EXPOSE_AI_GATEWAY_DB_PORT`.

To publish the three services on a deployment stack, add `docker-compose.expose-infra.yaml` as the last `-f` file:

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  -f docker-compose.expose-infra.yaml up -d
```

`docker-compose.prod.yaml` clears the ports with `ports: !reset []`, which requires Docker Compose 2.24 or later. Older versions stop with a parse error instead of publishing the ports. The prebuilt files do not use `!reset`, so they keep the v2.20 minimum. See [Network Exposure](setup_guide.md#network-exposure) for remote access and firewall guidance.

## Service Configuration

### Environment Variables
Each service has its own environment variable configuration that includes:
- Basic application settings (VERSION, APP_NAME, etc.)
- Database configuration
- Redis settings
- Service-specific variables

Example:
```yaml
environment:
  VERSION: ${VERSION}
  APP_NAME: ${APP_NAME}
  APP_ENV: ${APP_ENV:-development}
  NODE_ENV: ${APP_ENV:-development}
  DB_HOST: postgres
  DB_PORT: ${DB_PORT:-5432}
  # ... other variables
```

### Service Extensions
Services extend from their base definitions using Docker Compose's `extends` feature:

```yaml
services:
  postgres:
    extends:
      file: docker-compose.base.yaml
      service: postgres
```

### Secrets
Secrets are defined in the base configuration and referenced in service configurations:

```yaml
secrets:
  - db_password_server
  - redis_password
  # ... other secrets
```

## Best Practices

1. **Service Organization**
   - Keep base services in docker-compose.base.yaml
   - Use edition-specific files for specialized configurations
   - Maintain clear separation between CE and EE features

2. **Environment Variables**
   - Define defaults in compose files
   - Use .env files for local overrides
   - Follow naming conventions

3. **Service Dependencies**
   - Use `depends_on` with conditions
   - Ensure proper startup order
   - Handle service readiness

4. **Network Configuration**
   - Use dedicated networks
   - Name networks consistently
   - Control service exposure

## Development Workflow

1. Make changes to the base configuration if they apply to both editions
2. Update edition-specific configurations as needed
3. Test changes in both CE and EE environments
4. Update documentation if the structure changes

## Troubleshooting

If you encounter issues:

1. Verify you're using the correct combination of compose files
2. Check environment variables are properly set
3. Ensure secrets exist in the correct location
4. Review service logs for specific error messages

Common issues and solutions:

### Database Connection Issues
```bash
# Check postgres logs
docker compose logs postgres

# Verify environment variables
docker compose config
```

### Service Startup Issues
```bash
# Check service logs
docker compose logs [service-name]

# Verify service configuration
docker compose config --services
```

## Notes

- The base configuration provides core services and shared settings
- Edition-specific files add features and customizations
- Environment variables should be properly set in .env files
- Secrets are managed through Docker secrets
- Service dependencies are handled through depends_on conditions
- Networks are isolated per environment
