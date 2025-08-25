install_cli:
	./setup/bash/install_cli.sh

validate-secrets:
	@./scripts/validate-secrets.sh

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


