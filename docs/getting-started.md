# Getting Started with Alga PSA

This guide will have you running Alga PSA in under 5 minutes.

## Prerequisites

Before you begin, ensure you have:

- **Docker Engine 24.0+** - [Install Docker](https://docs.docker.com/get-docker/)
- **Docker Compose v2.20+** - Included with Docker Desktop
- **Git** - [Install Git](https://git-scm.com/downloads)

### Verify Prerequisites

```bash
# Check Docker version (should be 24.0+)
docker --version

# Check Docker Compose (should be v2.20+)
docker compose version

# Verify Docker is running
docker info
```

## Quick Start (Automated)

The fastest way to get started:

```bash
# Clone the repository
git clone https://github.com/nine-minds/alga-psa.git
cd alga-psa

# Run the quick start script (interactive)
./quickstart.sh

# Or run fully automated with auto-generated secrets
./quickstart.sh --auto
```

The script will:
1. Verify prerequisites
2. Ask how you'd like to set up secrets (auto-generate or enter manually)
3. Configure environment variables
4. Start all services

> **Tip:** Use `./quickstart.sh --auto` to skip prompts and auto-generate all secrets.

## Quick Start (Manual)

If you prefer manual setup:

### Step 1: Clone and Configure

```bash
# Clone the repository
git clone https://github.com/nine-minds/alga-psa.git
cd alga-psa

# Set the image tag
./scripts/set-image-tag.sh

# Generate secrets (interactive - choose auto-generate or enter your own)
./scripts/generate-secrets.sh

# Or auto-generate all secrets without prompts
./scripts/generate-secrets.sh --auto

# Create environment file
cp .env.example server/.env
```

### Step 2: Start Services

```bash
make up
```

Or if you prefer the full command:

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  --env-file server/.env --env-file .env.image up -d
```

### Step 3: Get Login Credentials

The first startup creates a default admin account. View the credentials:

```bash
make logs
```

Look for output like:
```
sebastian_server_ce  | *******************************************************
sebastian_server_ce  | ******** User Email is -> [ glinda@emeraldcity.oz ]  ********
sebastian_server_ce  | ********       Password is -> [ your-password-here ]   ********
sebastian_server_ce  | *******************************************************
```

### Step 4: Access the Application

Open your browser to: **http://localhost:3000**

Log in with the credentials from the logs.

## Common Commands

```bash
# Start services
make up

# Stop services
make down

# View logs
make logs

# Check service status
make status

# Restart services
make restart

# Pull latest images (for upgrades)
make pull

# Validate secrets configuration
make validate-secrets
```

## Troubleshooting

### Services won't start

1. Check Docker is running: `docker info`
2. Check for port conflicts: `docker compose ps`
3. View detailed logs: `make logs`

### Database authentication errors

If you see `password authentication failed`:

```bash
# Reset the Alga PSA database (WARNING: deletes all Alga data)
make down

# List Alga-specific volumes to verify before deletion
docker volume ls | grep alga

# Remove ONLY the Alga postgres volume (replace with actual volume name)
docker volume rm alga-psa_postgres_data

# Restart services
make up
```

> **Caution**: Always verify the volume name before deletion. Use `docker volume ls | grep alga` to see the exact volume names for your installation.

### Forgot login credentials

View the server logs - credentials are shown on first startup:

```bash
make logs | grep -A5 "User Email"
```

### Port 3000 already in use

Either stop the conflicting service, or edit `server/.env` to use a different port.

## Next Steps

- [Complete Setup Guide](setup_guide.md) - Detailed configuration options
- [Configuration Guide](configuration_guide.md) - Environment variables reference
- [Development Guide](development_guide.md) - Contributing and building from source

## Platform-Specific Notes

### macOS

Docker Desktop for Mac works out of the box. Ensure you have allocated sufficient resources in Docker Desktop preferences (recommended: 4GB+ RAM).

### Windows

Use WSL2 with Docker Desktop. See [Windows Setup Guide](setup_guide_windows.md) for detailed instructions.

### Linux

Install Docker Engine and Docker Compose plugin. Most distributions have packages available:

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install docker.io docker-compose-plugin

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group (logout/login required)
sudo usermod -aG docker $USER
```
