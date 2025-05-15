# Development Workstation

This document explains how to use the integrated development workstation with Alga PSA.

## Overview

The development workstation provides a VS Code environment in the browser that is pre-configured with the tools needed for working with Alga PSA. This makes it easy to:

- Set up new developer environments quickly
- Ensure consistent tooling across all developers
- Enable remote development without local setup
- Provide a complete development environment to new team members

## Getting Started

### Starting Options

You have three options for using the dev workstation:

#### Option 1: Full Environment with Direct Mount

Use this script to start the complete environment including all services and the dev workstation with a direct mount to your source code:

```bash
./scripts/start-dev-environment.sh
```

This script will:
1. Create required secrets and configuration files if they don't exist
2. Generate a random password for the dev workstation
3. Start all services including the dev workstation
4. Display access URLs and credentials

#### Option 2: Full Environment with Snapshot Support (Recommended)

Use this script to create a filesystem snapshot (if using btrfs) and start the complete environment with all services:

```bash
./scripts/start-full-environment-with-snapshot.sh
```

This script will:
1. Create a btrfs snapshot of your code if your filesystem supports it (fallback to direct mount if needed)
2. Configure all necessary secrets and environment files
3. Start the complete environment with all services using the snapshot
4. Display access URLs and credentials

This is the **recommended approach** as it combines the benefits of the full environment with the safety of working on a snapshot.

#### Option 3: Standalone Dev Workstation with Snapshot

Use this script to create a filesystem snapshot (if using btrfs) and start just the dev workstation without other services:

```bash
./scripts/create-snapshot-workstation.sh
```

This script will:
1. Create a btrfs snapshot of your code if your filesystem supports it
2. Fall back to a direct mount if btrfs isn't available
3. Start a standalone VS Code dev workstation container
4. Generate and display access credentials

The snapshot approach has several advantages:
- Work with code isolated from the original source (safe experimentation)
- Create multiple concurrent snapshots for different features
- Easily discard changes by stopping the container

### Accessing the Dev Workstation

After starting the environment, you can access the VS Code workstation in your browser:

```
http://<your-host-ip>:<dev-workstation-port>
```

The dev workstation port is configurable through the `DEV_WORKSTATION_PORT` environment variable, with a default of `8080`.

### Authentication

The dev workstation runs without authentication for convenience in secure environments. No password is required to access the VS Code interface - you can directly access it through the provided URL.

## Configuration

### Environment Variables

The following environment variables can be set to configure the dev workstation:

| Variable | Description | Default |
|----------|-------------|---------|
| `DEV_WORKSTATION_PORT` | The port to expose the dev workstation on | Random port assigned by Docker |

### Persistent Extensions

The dev workstation mounts a volume for storing VS Code extensions. This ensures that installed extensions persist between container restarts.

### Project Files

The project directory is mounted into the workstation, allowing direct editing of the source code.

## Advanced Usage

### Custom Docker Compose Configuration

The dev workstation is defined in `docker-compose.dev-workstation.yaml`. You can include this file with your custom docker compose commands:

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml -f docker-compose.dev-workstation.yaml --env-file server/.env up -d
```

### Working with Snapshots

If you're using the snapshot approach with `create-snapshot-workstation.sh`:

1. **Creating Multiple Snapshots**:
   You can create multiple snapshots for different features or experiments:
   ```bash
   DEV_WORKSTATION_PORT=8081 ./scripts/create-snapshot-workstation.sh
   DEV_WORKSTATION_PORT=8082 ./scripts/create-snapshot-workstation.sh
   ```

2. **Managing Snapshots**:
   Snapshots are stored in `~/snapshots/` with date-time stamps. You can:
   - Browse existing snapshots: `ls -la ~/snapshots/`
   - Remove a snapshot: `btrfs subvolume delete ~/snapshots/alga-psa-snap-20230501120000`

3. **Snapshot Requirements**:
   - Btrfs filesystem support is required for snapshots (automatically detected)
   - If btrfs is not available, the script falls back to direct mounting

### Adding Custom Tools

You can customize the dev workstation by modifying the Dockerfile at `tools/dev-workstation/dev-container/Dockerfile`.

### Multiple Dev Environments

You can run multiple isolated environments simultaneously by using the environment name parameter:

```bash
# Start multiple complete environments with different names
ENVIRONMENT_NAME=project-feature1 ./scripts/start-full-environment-with-snapshot.sh
ENVIRONMENT_NAME=project-feature2 ./scripts/start-full-environment-with-snapshot.sh
```

Each environment will:
- Use a unique name for all its containers
- Use randomly assigned ports to avoid conflicts 
- Run completely isolated from other environments
- Have its own network, database, and other services

### Multiple Dev Workstations

For standalone workstations, you can specify unique names:

```bash
# Start multiple workstation instances with different names
WORKSTATION_NAME=ws-feature1 ./scripts/create-snapshot-workstation.sh
WORKSTATION_NAME=ws-feature2 ./scripts/create-snapshot-workstation.sh
```

If you don't specify a name, one will be auto-generated for you. The scripts are designed to avoid conflicts, so you can run many instances concurrently.

## Troubleshooting

### Port Conflicts

If the default port (8080) is already in use, set a different port:

```bash
export DEV_WORKSTATION_PORT=8888
./scripts/start-dev-environment.sh
```

### Container Issues

If the dev workstation container doesn't start, check the logs:

```bash
docker logs $(docker ps --filter "name=dev-workstation" --format "{{.ID}}")
```

### Permission Issues

If you encounter permission issues with the mounted project directory, ensure the container user has appropriate permissions.

## Security Considerations

- The dev workstation should only be deployed in development environments
- Always set a strong password for the workstation
- Restrict network access to the dev workstation port when in shared environments
- Consider using HTTPS with a proper certificate for increased security