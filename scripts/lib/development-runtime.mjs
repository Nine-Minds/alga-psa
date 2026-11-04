// The one development runtime the browser lane compiles the application in
// (docker-compose.e2e-development.yaml). Evidence that a development-mode
// check ran binds to this image, not to the production candidate, which
// carries no development dependency tree.
export const DEVELOPMENT_RUNTIME_IMAGE = 'node:22-bookworm-slim';
export const DEVELOPMENT_RUNTIME_COMPOSE_FILE = 'docker-compose.e2e-development.yaml';
export const DEVELOPMENT_RUNTIME_WORKSPACE_TARGET = '/app';
