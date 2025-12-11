install_cli:
	./setup/bash/install_cli.sh

validate-secrets:
	@./scripts/validate-secrets.sh

generate-secrets:
	@./scripts/generate-secrets.sh

# ============================================================================
# Quick Start Commands (for open source users)
# ============================================================================
# These are simplified aliases for common operations

# Start Alga PSA (Community Edition with prebuilt images)
up:
	@docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
		--env-file server/.env --env-file .env.image up -d

# Stop all services
down:
	@docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
		--env-file server/.env --env-file .env.image down

# View logs (follow mode)
logs:
	@docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
		--env-file server/.env --env-file .env.image logs -f

# Show service status
status:
	@docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
		--env-file server/.env --env-file .env.image ps

# Pull latest images
pull:
	@docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
		--env-file server/.env --env-file .env.image pull

# Restart all services
restart: down up

# Show initial login credentials from logs
credentials:
	@docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
		--env-file server/.env --env-file .env.image logs | grep -A5 "User Email"

# Full quickstart setup
quickstart:
	@./quickstart.sh

# ============================================================================
# Development Commands (for building from source)
# ============================================================================

# Main docker commands with automatic validation
sebastian-docker-run:
	./setup/bash/run-compose.sh ./docker-compose.yaml -d

docker-up-ee:
	@./scripts/docker-compose-wrapper.sh -f docker-compose.yaml -f docker-compose.base.yaml -f docker-compose.ee.yaml up -d

docker-up-ce:
	@./scripts/docker-compose-wrapper.sh -f docker-compose.yaml -f docker-compose.base.yaml -f docker-compose.ce.yaml up -d

docker-down:
	@./scripts/docker-compose-wrapper.sh down

docker-logs:
	@./scripts/docker-compose-wrapper.sh logs -f

sebastian-docker-dev:
	./setup/bash/run-compose.sh ./docker-compose.yaml --watch

hocuspocus-docker-run:
	./setup/bash/run-compose.sh ./hocuspocus/docker-compose.yaml --no-network -d

hocuspocus-dev:
	make -C ./hocuspocus run-dev

server-docker-run:
	./setup/bash/run-compose.sh ./server/docker-compose.yaml --no-network -d

server-dev:
	make -C ./server run-dev

setup-docker-run:
	./setup/bash/run-compose.sh ./setup/docker-compose.yaml --no-network -d


