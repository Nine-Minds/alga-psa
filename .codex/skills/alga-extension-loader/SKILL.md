---
name: alga-extension-loader
description: Step-by-step troubleshooting and remediation workflow for Alga PSA extension UI loading issues, including runner configuration, bundle fetch validation, host iframe wiring, and tenant propagation fixes.
---

# Alga Extension Loader Troubleshooting

## Overview
Provide a deterministic checklist for diagnosing and fixing extension UI loading failures in local/dev Alga PSA environments. Covers runner-side fetch paths, MinIO bundle layout, iframe URL builders, tenant propagation, and Chrome/CLI verification commands.

## When to Use
- Extension iframe in MSP app stays on “Starting extension / Loading extension UI…”
- Runner logs emit `verify_archive fetch failed`, 404s for `bundle.tar.zst`/`main.js`, or `{"error":"not_installed"}` responses
- Freshly published Hello World (or any extension) renders in `curl` but not in the product
- Port/tenant mismatches suspected after switching environments or worktrees

## Workflow Summary
1. **Read runner config** → ensure bundle store + validation flags are correct
2. **Confirm MinIO assets** → bundle + UI files exist under tenant path
3. **Validate host wiring** → iframe src includes `tenant` & `extensionId`, loading overlay dismisses
4. **Rebuild & restart runner** → pick up code changes/environment overrides
5. **Smoke test delivery** → `curl` + Chrome DevTools MCP to ensure `index.html` and `main.js` return 200 and load in iframe
6. **Optional regression checks** → run vitest URL builder suite when modifying helpers

## Detailed Procedure

### 1. Runner Configuration
```bash
docker logs --tail 40 alga_extension_runner
```
Verify log line shows:
- `BUNDLE_STORE_BASE=http://host.docker.internal:9000/extensions`
- `EXT_STATIC_STRICT_VALIDATION=false` (for local dev; defaults to strict in prod)
- `REGISTRY_BASE_URL=http://host.docker.internal:3000/api/internal/ext-runner`

If `BUNDLE_STORE_BASE` still points to `4569/extensions`, restart with override:
```bash
RUNNER_BUNDLE_STORE_BASE=http://host.docker.internal:9000/extensions \
EXT_STATIC_STRICT_VALIDATION=false \
docker compose -f docker-compose.runner-dev.yml up --build -d extension-runner
```

Key code references:
- `docker-compose.runner-dev.yml` (env var wiring)
- `ee/runner/src/http/server.rs` (reads `BUNDLE_STORE_BASE`, `EXT_STATIC_STRICT_VALIDATION`)

### 2. MinIO Bundle & UI Layout
Each install stores bundles at `extensions/tenants/<tenant>/extensions/<extension>/sha256/<hash>/`.

Quick check:
```bash
mc ls local/extensions/tenants/$TENANT/extensions/$EXT/sha256/$HASH/
```
Expect to see `bundle.tar.zst`, `manifest.json`, and extracted UI files once runner fetch succeeds.

Runner logs to watch:
- `bundle fetch start` and `verify archive ok`
- `ext_ui serve ... main.js ... status=200` confirms cached UI serving

### 3. Host App Wiring
Ensure the iframe source includes tenant + extension query parameters and defaults to runner port for Docker backend.

Relevant files:
- `packages/product-extensions/ee/entry.tsx`
- `server/src/lib/extensions/assets/url.shared.ts`
- `packages/product-extensions/ee/DockerExtensionIframe.tsx`

Key expectations:
- `buildExtUiSrc(id, hash, '/', { tenantId, publicBaseOverride })` appends `?path=/&tenant=<id>&extensionId=<id>`
- Docker mode `publicBaseOverride` falls back to `http://localhost:${RUNNER_DOCKER_PORT||8085}`
- `DockerExtensionIframe` derives `allowedOrigin` from iframe src and clears the loading overlay on `load` or after a 1.5s fallback

If spinner persists, inspect overlay:
```javascript
// Chrome DevTools MCP console on MSP page
document.querySelector('.extension-loading-overlay')?.style.display
```
`null`/`undefined` indicates overlay removed.

### 4. Restart Runner After Code Changes
Whenever touching runner Rust code or env vars, rebuild:
```bash
RUNNER_BUNDLE_STORE_BASE=http://host.docker.internal:9000/extensions \
EXT_STATIC_STRICT_VALIDATION=false \
docker compose -f docker-compose.runner-dev.yml up --build -d extension-runner
```

### 5. Smoke Test Delivery
From host shell:
```bash
curl -I "http://localhost:8085/ext-ui/$EXT/$HASH/index.html?tenant=$TENANT"
curl -I "http://localhost:8085/ext-ui/$EXT/$HASH/main.js"
```
Expect `200 OK`, immutable cache headers, and non-zero `content-length`.

Chrome DevTools MCP (new tab):
- URL: `http://localhost:8085/ext-ui/<ext>/<hash>/index.html?tenant=<tenant>`
- Verify rendered document shows “Hello World” content and no 404

### 6. Regression Tests
When editing URL builders or iframe bridge logic, run:
```bash
npx vitest run ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts
```
Confirms tenant + extension query params in constructed URLs.

## Reference Commands
- Runner logs: `docker logs -f alga_extension_runner`
- Env override restart: see sections above
- Bundle fetch trace: `docker logs --tail 200 alga_extension_runner | rg "bundle fetch"`
- Rebuild SDK CLI (if republishing extension): `npm run build --workspace sdk/alga-client-sdk`

## Key Files & Responsibilities
| File | Purpose |
|------|---------|
| `ee/runner/src/http/ext_ui.rs` | Tenant resolution, bundle fetch, UI cache, hint cache |
| `ee/runner/src/engine/loader.rs` | Bundle URL assembly, S3 presign logic |
| `packages/product-extensions/ee/entry.tsx` | Decides iframe src per backend |
| `server/src/lib/extensions/assets/url.shared.ts` | Shared iframe URL builder |
| `packages/product-extensions/ee/DockerExtensionIframe.tsx` | Loading overlay + origin checks |
| `docker-compose.runner-dev.yml` | Runner container env defaults |

## Clean-up & Validation
- Remove stale runner cache if bundle hash changed dramatically:
  ```bash
  rm -rf server/.alga-ext-cache
  ```
- Clear Chrome profile specific to environment (e.g., `/tmp/chrome-mcp-profile-9223`) when resetting sessions
- Document resolution in project notes/log if new edge case encountered

