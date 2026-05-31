FROM node:20-bullseye AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL "https://storage.googleapis.com/kubernetes-release/release/$(curl -sSL https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

WORKDIR /app
ENV NODE_PATH=/app/shared/node_modules

COPY shared/ /app/shared
COPY packages/ /app/packages/
COPY server/src/ /app/server/src/
COPY server/package.json /app/server/package.json
COPY ee/server/src/ /app/ee/server/src/
COPY ee/packages/workflows/package.json /app/ee/packages/workflows/package.json
COPY ee/temporal-workflows/package*.json /app/ee/temporal-workflows/
COPY tsconfig.base.json /app/tsconfig.base.json
COPY tsconfig.json /app/tsconfig.json

# Install global build tooling used by package build scripts.
RUN npm install -g typescript

# Development stage
FROM base AS development

# Bring in the full sources (the base stage only copied package.jsons + some src).
WORKDIR /app
COPY ee/temporal-workflows/ /app/ee/temporal-workflows/
COPY ee/packages/workflows/ /app/ee/packages/workflows/
COPY packages/ /app/packages/
COPY package*.json /app/
COPY .npmrc /app/

# Single workspace-aware install. The root `workspaces` glob references members
# this Dockerfile doesn't copy (ee/server, services/*, sdk/*, tools/generators),
# so trim it to the members actually present in the image. A proper workspace
# install links every @alga-psa/* package locally and installs all members'
# deps in one consistent pass (build tooling like tsup, transitive deps like
# google-auth-library/openai), replacing the previous fragile per-package
# installs that resolved @alga-psa/* against the public registry and 404'd.
# --no-package-lock avoids reconciling against the committed root lock, which
# still records the trimmed-out workspaces.
RUN node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.workspaces=['packages/*','shared','ee/packages/workflows','ee/temporal-workflows'];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');console.log('trimmed workspaces to image-present members');"
RUN npm install --ignore-scripts --legacy-peer-deps --no-package-lock

# Build shared (its deps were installed by the workspace install above).
WORKDIR /app/shared
RUN npm run build
RUN npm run build

# Build event-schemas (imported at runtime by shared/workflow/streams)
WORKDIR /app/packages/event-schemas
RUN npx tsup

# Build @alga-psa/workflows (dist/lib/*.mjs required at runtime)
WORKDIR /app/ee/packages/workflows
RUN npx tsup

WORKDIR /app/ee/temporal-workflows
RUN npm run build

# Copy onboarding seeds after build
COPY ee/server/seeds/onboarding /app/ee/temporal-workflows/dist/seeds/onboarding

# Verify seeds were copied (debug step)
RUN ls -la /app/ee/temporal-workflows/dist/seeds/onboarding || echo "Seeds directory not found"

# Prebuilt dist stage for parity/runtime validation builds.
FROM base AS prebuilt

COPY ee/temporal-workflows/dist /app/ee/temporal-workflows/dist
COPY ee/server/seeds/onboarding /app/ee/temporal-workflows/dist/seeds/onboarding

RUN ls -la /app/ee/temporal-workflows/dist/seeds/onboarding || echo "Seeds directory not found in prebuilt stage"

# Production image from prebuilt artifacts (skips in-container TypeScript compilation).
FROM base AS production-prebuilt

COPY --from=prebuilt /app/ee/temporal-workflows/dist /app/ee/temporal-workflows/dist
# Copy integrations node_modules to both locations for module resolution
COPY --from=base /app/packages/integrations/node_modules /app/packages/integrations/node_modules
COPY --from=base /app/packages/integrations/node_modules /app/ee/temporal-workflows/dist/packages/integrations/node_modules
# Expose all local monorepo packages under @alga-psa/* for runtime resolution.
RUN mkdir -p /app/node_modules/@alga-psa \
    && for pkg in /app/packages/*; do \
      name="$(basename "$pkg")"; \
      ln -sfn "$pkg" "/app/node_modules/@alga-psa/$name"; \
    done \
    && ln -sfn /app/ee/temporal-workflows/node_modules /app/packages/node_modules

RUN ls -la /app/ee/temporal-workflows/dist/seeds/onboarding || echo "Seeds directory not found in prebuilt production stage"

RUN groupadd -r temporal && useradd -r -g temporal temporal
RUN chown -R temporal:temporal /app
USER temporal

WORKDIR /app/ee/temporal-workflows

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check: OK')" || exit 1

EXPOSE 8080

CMD ["node", "dist/ee/temporal-workflows/src/worker.js"]

# Production stage
FROM base AS production

# The development stage ran a single workspace install (deps hoisted under
# /app/node_modules with @alga-psa/* workspace symlinks) and built every dist,
# so copy the whole built tree wholesale. This replaces the old hand-rolled
# per-package node_modules copies + manual @alga-psa symlinks, which assumed the
# fragile per-package install layout.
COPY --from=development /app /app

# Verify seeds are present in production stage
RUN ls -la /app/ee/temporal-workflows/dist/seeds/onboarding || echo "Seeds directory not found in production stage"

# Create non-root user
RUN groupadd -r temporal && useradd -r -g temporal temporal \
    && chown -R temporal:temporal /app
USER temporal

WORKDIR /app/ee/temporal-workflows

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check: OK')" || exit 1

# Expose health check port
EXPOSE 8080

# Default command runs the worker
CMD ["node", "dist/ee/temporal-workflows/src/worker.js"]
