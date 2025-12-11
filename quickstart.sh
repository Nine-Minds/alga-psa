#!/bin/bash

# Alga PSA Quick Start Script
# This script automates the setup process for new installations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_step() { echo -e "${BLUE}==>${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Alga PSA Quick Start                      ║"
echo "║              Community Edition Installer                   ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check prerequisites
print_step "Checking prerequisites..."

# Check Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
print_success "Docker installed (version: $DOCKER_VERSION)"

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    print_error "Docker Compose v2 is not installed."
    echo "   Docker Compose v2 comes bundled with Docker Desktop."
    echo "   For Linux, see: https://docs.docker.com/compose/install/"
    exit 1
fi

COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "unknown")
print_success "Docker Compose installed (version: $COMPOSE_VERSION)"

# Check if Docker is running
if ! docker info &> /dev/null; then
    print_error "Docker daemon is not running. Please start Docker."
    exit 1
fi
print_success "Docker daemon is running"

# Check for git
if ! command -v git &> /dev/null; then
    print_error "Git is not installed. Please install Git first."
    exit 1
fi
print_success "Git installed"

echo ""
print_step "Setting up image tag..."

# Run set-image-tag script if it exists
if [ -f "./scripts/set-image-tag.sh" ]; then
    ./scripts/set-image-tag.sh
    print_success "Image tag configured"
else
    print_warning "set-image-tag.sh not found, using default tag"
fi

echo ""
print_step "Generating secrets..."

# Generate secrets
if [ -f "./scripts/generate-secrets.sh" ]; then
    ./scripts/generate-secrets.sh
else
    # Inline secret generation if script doesn't exist
    mkdir -p secrets

    generate_secret() {
        local length=${1:-32}
        if command -v openssl &> /dev/null; then
            openssl rand -base64 $length | tr -d '/+=' | head -c $length
        else
            head -c 100 /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c $length
        fi
    }

    # Only generate if files don't exist
    [ ! -f secrets/postgres_password ] && generate_secret 24 > secrets/postgres_password
    [ ! -f secrets/db_password_server ] && generate_secret 24 > secrets/db_password_server
    [ ! -f secrets/db_password_hocuspocus ] && generate_secret 24 > secrets/db_password_hocuspocus
    [ ! -f secrets/redis_password ] && generate_secret 24 > secrets/redis_password
    [ ! -f secrets/alga_auth_key ] && generate_secret 32 > secrets/alga_auth_key
    [ ! -f secrets/crypto_key ] && generate_secret 32 > secrets/crypto_key
    [ ! -f secrets/token_secret_key ] && generate_secret 32 > secrets/token_secret_key
    [ ! -f secrets/nextauth_secret ] && generate_secret 32 > secrets/nextauth_secret

    # Create placeholder files for optional secrets
    [ ! -f secrets/email_password ] && echo "placeholder" > secrets/email_password
    [ ! -f secrets/google_oauth_client_id ] && echo "placeholder" > secrets/google_oauth_client_id
    [ ! -f secrets/google_oauth_client_secret ] && echo "placeholder" > secrets/google_oauth_client_secret

    chmod 600 secrets/*
fi
print_success "Secrets generated in ./secrets/"

echo ""
print_step "Setting up environment configuration..."

# Create .env file if it doesn't exist
if [ ! -f server/.env ]; then
    if [ -f .env.example ]; then
        cp .env.example server/.env
        print_success "Created server/.env from template"
    else
        print_error "No .env.example found"
        exit 1
    fi
else
    print_warning "server/.env already exists, skipping"
fi

echo ""
print_step "Starting Alga PSA services..."

# Start Docker Compose
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
    --env-file server/.env --env-file .env.image up -d

echo ""
print_step "Waiting for services to initialize..."

# Wait for the server to be healthy (with timeout)
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
        --env-file server/.env --env-file .env.image ps 2>/dev/null | grep -q "healthy\|running"; then
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
    print_warning "Services are still starting. Check logs for details."
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Setup Complete!                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
print_success "Alga PSA is starting up!"
echo ""
echo "   Application URL: ${GREEN}http://localhost:3000${NC}"
echo ""
echo "   To view your login credentials (first-time only):"
echo "   ${YELLOW}docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml --env-file server/.env --env-file .env.image logs | grep -A3 'User Email'${NC}"
echo ""
echo "   Or use the shorthand:"
echo "   ${YELLOW}make logs${NC}"
echo ""
echo "   Useful commands:"
echo "   - View logs:     make logs"
echo "   - Stop services: make down"
echo "   - Start again:   make up"
echo ""
print_warning "Note: First startup may take 1-2 minutes while the database initializes."
echo ""
