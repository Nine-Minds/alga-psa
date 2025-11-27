# Local Development Guide: Running Extensions with Docker Runner

This guide explains how to set up and run Alga PSA extensions locally using the Docker-based Runner for iterative development and debugging.

## Overview

The local development workflow allows you to:
- Build and test extension handlers (WASM components) in isolation
- Run extensions in the Docker-based Runner without full production infrastructure
- Test UI components in iframes with hot-reload
- Debug component execution with structured logging and debugging tools
- Iterate rapidly without pushing to production

## Prerequisites

- Docker and Docker Compose
- Node.js 18+
- An Alga PSA extension project or template (see [development_guide.md](development_guide.md))
- The main app server running locally (for the gateway)
- (Optional) The Alga CLI for streamlined builds: `npm install -g @alga-psa/cli`

## Architecture: Local Runner Setup

```
Local Dev Environment:
┌─────────────────────────────────────────────────────────────────┐
│ Host Machine                                                    │
│                                                                 │
│  ┌──────────────────┐              ┌─────────────────────────┐ │
│  │ Extension Project│              │ Alga App Server         │ │
│  │ (WASM + UI)      │              │ (Next.js)               │ │
│  └────────┬─────────┘              └────────┬────────────────┘ │
│           │                                  │                  │
│           │ $ npm run build                  │ $ npm run dev    │
│           │                                  │                  │
│           │  Generated:                      └───────┬──────────┘
│           │  - dist/main.wasm                        │
│           │  - ui/dist/index.html                    │
│           │  - manifest.json                         │
│           ▼                                          │
│  ┌──────────────────────────┐    API Gateway         │
│  │ Extension Bundle Store   │◄──────────────────────┘
│  │ (temp directory)         │   GET /api/ext/{id}
│  └──────────────────────────┘   POST /api/ext/{id}/...
│           ▲                                                      │
│           │ (fetch bundle)                                       │
│           │                                                      │
│  ┌────────┴─────────────────────────────────────────────────┐   │
│  │ Docker Container: Extension Runner                       │   │
│  │ ┌──────────────────────────────────────────────────────┐ │   │
│  │ │ Service: extension-runner                            │ │   │
│  │ │ Port: 8085 (mapped from 8080)                       │ │   │
│  │ │                                                      │ │   │
│  │ │ - POST /v1/execute: Run handlers                    │ │   │
│  │ │ - GET /ext-ui/{id}/{hash}/: Serve UI assets        │ │   │
│  │ │ - Wasmtime: Execute WASM components                │ │   │
│  │ │ - Static file server for iframe assets             │ │   │
│  │ └──────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start MinIO (Bundle Storage)

The extension runner fetches bundles from S3-compatible storage. For local development, use MinIO:

```bash
# Start MinIO container (port 4569 for API, 4570 for console)
docker run -d --name alga_minio \
  -p 4569:9000 -p 4570:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Create the extensions bucket
docker run --rm --network host --entrypoint /bin/sh minio/mc -c \
  "mc alias set myminio http://localhost:4569 minioadmin minioadmin && mc mb myminio/extensions"
```

**Verify MinIO is running:**
- API: http://localhost:4569
- Console: http://localhost:4570 (login: minioadmin/minioadmin)

### 2. Start the Docker Runner

From the Alga app root:

```bash
docker compose -f docker-compose.runner-dev.yml up --build
```

This starts the `extension-runner` container on `localhost:8085`.

**Check it's running:**
```bash
curl http://localhost:8085/healthz
# or check logs:
docker logs -f alga_extension_runner
```

### 3. Start the Main App Server

In another terminal, from the app root:

```bash
cd server && PORT=3004 npm run dev
```

This runs the gateway that proxies `/runner/` requests to the extension runner.

**Important:** Make sure your `server/.env` has the correct runner configuration:
```bash
RUNNER_BACKEND=docker
RUNNER_BASE_URL=http://localhost:8085
RUNNER_DOCKER_HOST=http://localhost:8085
RUNNER_PUBLIC_BASE=/runner
RUNNER_SERVICE_TOKEN=local-runner-key
```

### 4. Build Your Extension

From your extension project root:

**Using the Alga CLI (recommended):**
```bash
alga build
# Automatically compiles TypeScript and creates WASM component
# Outputs: dist/main.wasm (for WASM extensions)
```

**Using npm scripts:**
```bash
npm run build
npm run build:component
# Produces: dist/main.wasm, ui/dist/**, manifest.json
```

For simple UI-only extensions (like the hello-world sample), you only need the UI files and manifest.

### 5. Create and Upload the Bundle

The runner expects bundles as `.tar.zst` archives in MinIO. Here's the complete process:

```bash
# 1. Create the bundle archive from your extension directory
cd ./path/to/extension
tar --zstd -cvf /tmp/my-extension-bundle.tar.zst manifest.json ui/
# For extensions with WASM handlers, include dist/:
# tar --zstd -cvf /tmp/my-extension-bundle.tar.zst manifest.json ui/ dist/

# 2. Calculate the SHA256 hash of the bundle
BUNDLE_HASH=$(shasum -a 256 /tmp/my-extension-bundle.tar.zst | cut -d' ' -f1)
echo "Bundle hash: $BUNDLE_HASH"

# 3. Upload to MinIO with the correct path structure
# Path format: tenants/{tenant_id}/extensions/{extension_id}/sha256/{hash}/bundle.tar.zst
TENANT_ID="your-tenant-uuid"  # Get this from the app UI or database
EXT_ID="your-extension-uuid"   # Generated by the install script

docker run --rm --network host --entrypoint /bin/sh -v /tmp:/tmp minio/mc -c \
  "mc alias set myminio http://localhost:4569 minioadmin minioadmin && \
   mc cp /tmp/my-extension-bundle.tar.zst myminio/extensions/tenants/${TENANT_ID}/extensions/${EXT_ID}/sha256/${BUNDLE_HASH}/bundle.tar.zst"
```

### 6. Install Extension Metadata in Database

```bash
# Set database connection (adjust for your environment)
export PGPASSWORD=$(cat secrets/postgres_password)

# Run the install script
DB_HOST=localhost DB_PORT=5436 node scripts/dev-install-extension.mjs ./path/to/extension
```

**Important:** The install script uses a default tenant ID. You may need to update it:

```bash
# Find your actual tenant ID (visible in the app header or query the database)
psql -h localhost -p 5436 -U postgres -d server -c "SELECT tenant FROM tenants LIMIT 1;"

# Update the install to use your tenant
psql -h localhost -p 5436 -U postgres -d server -c \
  "UPDATE tenant_extension_install SET tenant_id = 'your-actual-tenant-id' WHERE registry_id = 'extension-registry-id';"
```

**Update the content hash** to match your bundle:

```bash
psql -h localhost -p 5436 -U postgres -d server -c \
  "UPDATE extension_bundle SET content_hash = 'sha256:${BUNDLE_HASH}' WHERE version_id = 'your-version-id';"
```

### 7. Test Your Extension

**Restart the runner** (to clear any cached failures):
```bash
docker restart alga_extension_runner
```

**Load the UI in a browser:**
```
http://localhost:3004/msp/extensions/{extension-registry-id}/
```

The extension should appear in the sidebar menu under "EXTENSIONS" and load in an iframe when clicked.

**Call your handler via the gateway (for server-to-server testing):**
```bash
curl -X POST http://localhost:3004/api/ext/{extension-id}/path \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"data": "test"}'
```

> **Note:** For UI→Handler communication, use the **postMessage proxy pattern** instead of direct `fetch()` calls. See the [Development Guide](development_guide.md#calling-your-wasm-handler-from-the-ui-postmessage-proxy-pattern) for details.

## Complete Example: Hello World Extension

Here's a complete walkthrough using the built-in hello-world sample extension:

```bash
# 1. Start MinIO
docker run -d --name alga_minio \
  -p 4569:9000 -p 4570:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

docker run --rm --network host --entrypoint /bin/sh minio/mc -c \
  "mc alias set myminio http://localhost:4569 minioadmin minioadmin && mc mb myminio/extensions"

# 2. Start the extension runner
docker compose -f docker-compose.runner-dev.yml up --build -d

# 3. Create the bundle
cd ee/extensions/samples/hello-world
tar --zstd -cvf /tmp/hello-world-bundle.tar.zst manifest.json ui/

# 4. Calculate the hash
BUNDLE_HASH=$(shasum -a 256 /tmp/hello-world-bundle.tar.zst | cut -d' ' -f1)
echo "Bundle hash: $BUNDLE_HASH"

# 5. Install extension metadata (from repo root)
cd ../../../..
export PGPASSWORD=$(cat secrets/postgres_password)
DB_HOST=localhost DB_PORT=5436 node scripts/dev-install-extension.mjs ./ee/extensions/samples/hello-world

# The script outputs the registry_id and version_id - note these for the next steps
# Example output:
#   Registry ID: 3b8b0204-25d9-57d0-951b-3ed518145469
#   Version entry created/updated: d1164241-1ba8-525c-bcee-689e6fa1a534

# 6. Get your tenant ID (check the app header after logging in, or query):
psql -h localhost -p 5436 -U postgres -d server -c "SELECT tenant FROM tenants LIMIT 1;"
# Example: 1573867a-384d-4555-a206-bcfd86440ac1

# 7. Update tenant_extension_install to use your tenant
TENANT_ID="1573867a-384d-4555-a206-bcfd86440ac1"  # Use your actual tenant ID
EXT_ID="3b8b0204-25d9-57d0-951b-3ed518145469"     # Use the registry_id from step 5

psql -h localhost -p 5436 -U postgres -d server -c \
  "UPDATE tenant_extension_install SET tenant_id = '${TENANT_ID}' WHERE registry_id = '${EXT_ID}';"

# 8. Update the content hash in the database
VERSION_ID="d1164241-1ba8-525c-bcee-689e6fa1a534"  # Use the version_id from step 5

psql -h localhost -p 5436 -U postgres -d server -c \
  "UPDATE extension_bundle SET content_hash = 'sha256:${BUNDLE_HASH}' WHERE version_id = '${VERSION_ID}';"

# 9. Upload bundle to MinIO
docker run --rm --network host --entrypoint /bin/sh -v /tmp:/tmp minio/mc -c \
  "mc alias set myminio http://localhost:4569 minioadmin minioadmin && \
   mc cp /tmp/hello-world-bundle.tar.zst myminio/extensions/tenants/${TENANT_ID}/extensions/${EXT_ID}/sha256/${BUNDLE_HASH}/bundle.tar.zst"

# 10. Restart runner to clear any cached errors
docker restart alga_extension_runner

# 11. Start the server (in server/ directory)
cd server && PORT=3004 npm run dev

# 12. Open browser to http://localhost:3004 and log in
# The "Hello World" extension should appear in the sidebar under "EXTENSIONS"
```

## Configuration

### Environment Variables

Configure the Runner and Gateway via `.env.runner`:

```bash
# Copy the example:
cp .env.runner.example .env.runner

# Edit to match your setup:
```

**Key variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUNNER_REGISTRY_BASE_URL` | `http://host.docker.internal:3000/api/internal/ext-runner` | Gateway's internal URL to Runner (used by gateway to call runner) |
| `RUNNER_BUNDLE_STORE_BASE` | `http://host.docker.internal:4569/extensions` | Base URL where Runner fetches bundles (object storage or temp dir) |
| `RUNNER_ALGA_AUTH_KEY` | `dev-runner-key` | Service auth key for runner ↔ gateway communication |
| `RUNNER_DOCKER_PORT` | `8085` | Port mapping from container (8080) to host |
| `RUNNER_STATIC_STRICT_VALIDATION` | `false` | Strict validation of UI asset hashes (disable for dev) |

**Additional Runner options (advanced):**

```bash
# Wasmtime component pool size
WASM_POOL_TOTAL_COMPONENTS=256

# Static file cache location in container
EXT_CACHE_ROOT=/app/tmp-ext

# Max file size for UI assets
EXT_STATIC_MAX_FILE_BYTES=10485760

# HTTP egress allowlist (comma-separated)
EXT_EGRESS_ALLOWLIST=httpbin.org,api.example.com

# Gateway timeout for extension execution
EXT_GATEWAY_TIMEOUT_MS=5000

# Debug Redis stream (optional, see debugging section)
RUNNER_DEBUG_REDIS_URL=redis://host.docker.internal:6379
RUNNER_DEBUG_REDIS_STREAM_PREFIX=ext:debug
```

### Docker Compose Overrides

If you need to customize the runner container, edit `docker-compose.runner-dev.yml`:

```yaml
services:
  extension-runner:
    environment:
      # Override any environment variable here
      EXT_CACHE_ROOT: /custom/cache/path
    ports:
      # Change the host port
      - "9085:8080"
    volumes:
      # Add additional volumes
      - /path/to/bundles:/app/bundles:ro
```

Then rebuild:
```bash
docker compose -f docker-compose.runner-dev.yml up --build
```

## Workflow: Edit → Build → Test

### For Handler Changes (WASM)

1. Edit `src/component/handler.ts`
2. Run build:
   ```bash
   npm run build && npm run build:component
   ```
3. Reinstall the extension:
   ```bash
   node scripts/dev-install-extension.mjs .
   ```
4. Test:
   ```bash
   curl -X POST http://localhost:3000/api/ext/com.example.my-extension/path
   ```

### For UI Changes (Iframe)

1. Edit `src/ui/src/main.tsx` or components
2. Build:
   ```bash
   npm run build    # builds ui/dist
   npm run build:component  # updates main.wasm if handlers changed
   ```
3. Reinstall:
   ```bash
   node scripts/dev-install-extension.mjs .
   ```
4. Reload the iframe in browser (Cmd+R or F5)

### Hot Reload (Optional)

If you want to avoid reinstalling after every build, you can use a Vite dev server for the UI:

```bash
npm run ui:dev   # serves ui from localhost:5173
```

Then in your test app, point the iframe to `http://localhost:5173/index.html` instead of the Runner's static path. This is **not recommended for production**, but useful for rapid UI iteration.

## Bundle and Installation

### Understanding the Installation Script

The [dev-install-extension.mjs](../../../scripts/dev-install-extension.mjs) script:

1. **Reads manifest.json** from your extension root
2. **Calculates content hash** (SHA256) of the built artifacts:
   - `manifest.json`
   - `dist/main.wasm`
   - `ui/dist/**/*`
3. **Checks for unsigned bundles** (dev-only; production requires signatures)
4. **Inserts into database:**
   - `extension_registry` (extension metadata)
   - `extension_version` (version record)
   - `extension_bundle` (bundle metadata + content hash)
   - `tenant_extension_install` (install for local tenant)
5. **Uses deterministic UUIDs** based on extension name (for consistency across rebuilds)

### Uninstalling an Extension

To remove a locally-installed extension:

```bash
node scripts/dev-uninstall-extension.mjs com.example.my-extension
```

This removes all database records. The next `/api/ext/...` call will fail with "extension not found".

## Debugging

### Logs

**Runner logs:**
```bash
docker logs -f alga_extension_runner
```

Look for:
- `Starting runner on port 8080`
- `[POST /v1/execute]` handler invocations
- `ERROR` or `WARN` messages

**Gateway logs:**
```bash
# In your app dev terminal
npm run dev    # shows Next.js logs
```

Look for:
- `[GET /api/ext/...]` requests
- `Calling runner at ...`
- `ERROR` responses

### Structured Logging from Handlers

Use `@alga-psa/extension-runtime` logging to emit structured logs:

```ts
import { Handler, jsonResponse } from '@alga-psa/extension-runtime';

export const handler: Handler = async (req, host) => {
  // Emit a log message
  await host.logging.emit({
    level: 'info',
    message: 'Processing request',
    fields: { path: req.http.path, method: req.http.method },
  });

  try {
    const data = await host.http.fetch({ url: 'https://api.example.com/data' });
    await host.logging.emit({
      level: 'debug',
      message: 'Upstream response',
      fields: { status: data.status },
    });
    return jsonResponse({ ok: true });
  } catch (err) {
    await host.logging.emit({
      level: 'error',
      message: 'Request failed',
      fields: { error: String(err) },
    });
    return jsonResponse({ ok: false, error: String(err) }, { status: 500 });
  }
};
```

These logs appear in the Runner logs and can be collected by your observability system.

### Debug Stream (Advanced)

For detailed execution traces, set up a Redis debug stream:

1. **Start Redis:**
   ```bash
   docker run -p 6379:6379 redis
   ```

2. **Configure Runner:**
   ```bash
   # In .env.runner:
   RUNNER_DEBUG_REDIS_URL=redis://host.docker.internal:6379
   RUNNER_DEBUG_REDIS_STREAM_PREFIX=ext:debug
   ```

3. **Tail the stream:**
   ```bash
   redis-cli
   > XREAD COUNT 10 STREAMS ext:debug 0
   ```

Each extension execution emits debug events (context, handler start, host API calls, response).

## Common Issues

### Runner Container Won't Start

**Error:** `Container exited with code 1`

**Check:**
1. Docker is running: `docker ps`
2. Port 8085 is available: `lsof -i :8085`
3. Build succeeded: `docker compose -f docker-compose.runner-dev.yml build --no-cache`
4. Logs: `docker logs alga_extension_runner`

**Fix:** Stop conflicting containers and rebuild:
```bash
docker compose -f docker-compose.runner-dev.yml down
docker compose -f docker-compose.runner-dev.yml up --build
```

### Extension Installation Fails

**Error:** `Extension not found in database` when calling gateway

**Check:**
1. Did the install script complete? `node scripts/dev-install-extension.mjs .` should show `✓`
2. Is the manifest.json valid? `cat manifest.json | jq`
3. Are the build artifacts present?
   ```bash
   ls dist/main.wasm
   ls ui/dist/index.html
   ```

**Fix:** Rebuild and reinstall:
```bash
npm run build && npm run build:component
node scripts/dev-uninstall-extension.mjs com.example.my-extension || true
node scripts/dev-install-extension.mjs .
```

### 404 on Extension Handler Call

**Error:** `POST /api/ext/com.example.my-extension/path` returns 404

**Check:**
1. Is the gateway running? `curl http://localhost:3000/api/health`
2. Is the runner running? `curl http://localhost:8085/health`
3. Is the extension installed? Check the database or call with a nonexistent ID (should get different error)

**Fix:** Restart the gateway:
```bash
# Ctrl+C in the dev terminal
npm run dev:runner
```

### WASM Component Panics

**Error:** `ERROR: Execution failed: Wasm trap` in runner logs

**Check:**
1. Are you using `@alga-psa/extension-runtime` correctly? Review the [development_guide.md](development_guide.md#building-server-handlers-componentized-wasm).
2. Is the handler function exported as default? `export const handler: Handler = ...`
3. Are you accessing capabilities that aren't granted? Check your manifest `capabilities`.

**Fix:** Review the stack trace in logs and the handler implementation.

### UI Not Loading in Iframe

**Error:** Iframe blank or 404 on `GET /runner/ext-ui/...`

**Check:**
1. Is `ui/dist/index.html` present? `ls ui/dist/index.html`
2. Is the content hash correct? (Should match install records in DB)
3. Are the assets within the bundle? `tar -tzf bundle.tar.zst | head`

**Fix:** Rebuild and reinstall:
```bash
npm run build
node scripts/dev-install-extension.mjs .
# Hard refresh iframe in browser (Cmd+Shift+R)
```

### Extension Shows `{"code":"extract_failed"}`

**Error:** The iframe shows `{"code":"extract_failed"}` JSON

**Cause:** The runner cannot fetch or extract the bundle from MinIO.

**Check:**
1. Is MinIO running? `curl http://localhost:4569/minio/health/live`
2. Does the `extensions` bucket exist?
3. Is the bundle uploaded to the correct path?
4. Check runner logs: `docker logs alga_extension_runner`

**Common issues in runner logs:**
- `error sending request for url`: MinIO not reachable from the runner container
- `400 Bad Request`: Bundle not found at the expected path
- `HASH_MISMATCH`: The content hash in the database doesn't match the actual bundle

**Fix:**
```bash
# Verify bundle exists in MinIO
docker run --rm --network host --entrypoint /bin/sh minio/mc -c \
  "mc alias set myminio http://localhost:4569 minioadmin minioadmin && mc ls myminio/extensions/tenants/ --recursive"

# Re-upload if needed (see step 5 in Quick Start)
```

### Extension Shows `{"code":"archive_hash_mismatch"}`

**Error:** The runner fetched the bundle but the hash doesn't match

**Cause:** The `content_hash` in the database doesn't match the SHA256 of the uploaded bundle.

**Fix:**
```bash
# 1. Calculate the actual hash of your bundle
shasum -a 256 /tmp/my-extension-bundle.tar.zst

# 2. Update the database with the correct hash
export PGPASSWORD=$(cat secrets/postgres_password)
psql -h localhost -p 5436 -U postgres -d server -c \
  "UPDATE extension_bundle SET content_hash = 'sha256:YOUR_ACTUAL_HASH' WHERE version_id = 'your-version-id';"

# 3. Re-upload to MinIO with the correct path (using the actual hash)
# 4. Restart the runner to clear cache
docker restart alga_extension_runner
```

### Extension Not Showing in Sidebar Menu

**Error:** Extension installed but doesn't appear in the sidebar

**Cause:** The extension is installed for a different tenant than you're logged in as.

**Check:**
```bash
# Find your current tenant (shown in the app header)
# Then check what tenant the extension is installed for:
psql -h localhost -p 5436 -U postgres -d server -c \
  "SELECT tenant_id FROM tenant_extension_install WHERE registry_id = 'your-extension-id';"
```

**Fix:**
```bash
psql -h localhost -p 5436 -U postgres -d server -c \
  "UPDATE tenant_extension_install SET tenant_id = 'your-actual-tenant-id' WHERE registry_id = 'your-extension-id';"
```

Then refresh the page.

## Advanced: Running Multiple Extensions

You can develop and test multiple extensions simultaneously:

```bash
# Terminal 1: Start runner once
docker compose -f docker-compose.runner-dev.yml up

# Terminal 2: Start main app
npm run dev:runner

# Terminal 3+: Install and develop each extension
cd extension-1
npm run build && npm run build:component
node ../../scripts/dev-install-extension.mjs .

cd ../extension-2
npm run build && npm run build:component
node ../../scripts/dev-install-extension.mjs .
```

Then call each via `/api/ext/{extensionId}/...` in your tests.

## Advanced: Custom Runner Configuration

### Building a Modified Runner Locally

If you need to modify the Runner itself (in `ee/runner/`):

1. Edit Rust code in `ee/runner/src/`
2. Rebuild:
   ```bash
   docker compose -f docker-compose.runner-dev.yml up --build --force-recreate
   ```
3. Docker will recompile the Rust binary and restart the container

### Bundle Storage Path Structure

The runner expects bundles in MinIO at a specific path structure:

```
extensions/tenants/{tenant_id}/extensions/{extension_id}/sha256/{content_hash}/bundle.tar.zst
```

Where:
- `tenant_id`: UUID of the tenant (found in app header or `tenants` table)
- `extension_id`: UUID from `extension_registry.id`
- `content_hash`: SHA256 hash of the bundle archive (without `sha256:` prefix)

**Example path:**
```
extensions/tenants/1573867a-384d-4555-a206-bcfd86440ac1/extensions/3b8b0204-25d9-57d0-951b-3ed518145469/sha256/c4bf05d95138f23599c175b28ad6460cd268ad0e498f581526af9e8097318201/bundle.tar.zst
```

### MinIO Configuration in `.env.runner`

The default `.env.runner` is pre-configured for MinIO on port 4569:

```bash
RUNNER_BUNDLE_STORE_BASE=http://host.docker.internal:4569/extensions
BUNDLE_STORE_BASE=http://host.docker.internal:4569/extensions
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1
```

If you need to use different ports or credentials, update these values accordingly.

## Related Documentation

- [Development Guide](development_guide.md) — Building and structuring extensions
- [Manifest Schema](manifest_schema.md) — Extension configuration reference
- [Runner](runner.md) — Runner architecture and interfaces
- [Security & Signing](security_signing.md) — Production signing and verification
- [API Routing Guide](api-routing-guide.md) — Extension HTTP endpoints

## Next Steps

Once you're comfortable with local development:

1. **Write tests** — Use `@alga-psa/extension-runtime` testing utilities
2. **Deploy to staging** — Publish your bundle and install on a staging Alga instance
3. **Set up CI/CD** — Automate bundling, signing, and publishing (see [enterprise-build-workflow.md](enterprise-build-workflow.md))
4. **Monitor in production** — Use structured logging and debug streams for observability
