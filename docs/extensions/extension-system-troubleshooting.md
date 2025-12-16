# Skill: Extension System Troubleshooting (Alga PSA)

## Summary
Guided playbook for diagnosing and fixing Alga PSA extension UI delivery when the iframe shows a spinner or `{"error":"not_installed"}`. Captures the fixes from the most recent runner/host changes so future incidents can be resolved quickly.

## Tags
`extensions` `runner` `docker` `minio` `ui`

## When to Use
- Extension iframe in MSP app stays on “Starting extension / Loading extension UI…”
- Runner logs show `verify_archive fetch failed`, `strict validation on and tenant resolution failed`, or 404s for bundle assets.
- After publishing/installing an extension locally and the UI never loads.

## Pre-flight Checklist
- Local docker stack is up (`docker compose -f docker-compose.runner-dev.yml up` and supporting services).
- Extension is installed (`alga extensions list` should show status `enabled`).
- You have access to the `.env.runner` used by the runner container.

## Diagnostic & Fix Flow

### 1. Verify Runner Configuration
```bash
docker logs --tail 20 alga_extension_runner
```
- Confirm `BUNDLE_STORE_BASE` points at `http://host.docker.internal:9000/extensions`.
- If it shows `4569/extensions`, restart with:
```bash
RUNNER_BUNDLE_STORE_BASE=http://host.docker.internal:9000/extensions \
  docker compose -f docker-compose.runner-dev.yml up --build -d extension-runner
```

### 2. Check Bundle Fetch
- Watch for `verify archive fetch failed` or 404s; if present, the runner can’t locate `bundle.tar.zst`.
- Ensure MinIO has the tenant-scoped path:
```bash
mc ls local/extensions/tenants/<tenant-id>/extensions/<ext-id>/sha256/<hash>/
```

### 3. Confirm Install Metadata
```bash
node scripts/dev-install-extension.mjs --info <extension-id>
```
- Make sure `content_hash` is populated and matches the bundle in MinIO.
- If missing, re-run `alga publish ...` and `alga extensions install ...`.

### 4. Tenant Context Handling
- Runner now caches tenant hints; requests without `x-tenant-id` succeed if the iframe includes `?tenant=<id>&extensionId=<id>`.
- In the MSP app, ensure `buildExtUiSrc(...)` emits both query params (this is handled automatically after commit `HEAD`).

### 5. Frontend Spinner
- The Docker iframe uses a hard stop gap: it toggles loading state on iframe `onLoad` or after 1.5 s.
- If the spinner persists:
  1. Open Chrome DevTools MCP page list.
  2. Navigate to `http://localhost:8085/ext-ui/<ext-id>/<hash>/index.html?tenant=<tenant>`.
  3. Verify `main.js` loads (should return `200 OK`).
  4. Look for console errors in the iframe; if none, the iframe should render the Hello World page.

### 6. Runner Strict Validation
- Environment variable `EXT_STATIC_STRICT_VALIDATION=false` relaxes tenant enforcement for local dev.
- For CI/production, keep it `true` and ensure host sets `x-tenant-id` before shipping.

## Quick Reference Commands
```bash
# Restart runner with correct bundle store and strict validation disabled
RUNNER_BUNDLE_STORE_BASE=http://host.docker.internal:9000/extensions \
EXT_STATIC_STRICT_VALIDATION=false \
docker compose -f docker-compose.runner-dev.yml up --build -d extension-runner

# Tail runner logs
docker logs -f alga_extension_runner

# Fetch extension UI (verify index + assets)
curl -I "http://localhost:8085/ext-ui/<ext-id>/<hash>/index.html?tenant=<tenant>"
curl -I "http://localhost:8085/ext-ui/<ext-id>/<hash>/main.js"
```

## Notes
- The iframe URL builder now appends `extensionId` to queries; ensure any custom consumers follow the same pattern.
- Browser testing via Chrome DevTools MCP requires pointing at the runner port (8085) and supplying the tenant query manually.
- For persistent issues, re-run `npx vitest run ee/server/src/lib/extensions/__tests__/assets/url.shared.test.ts` to confirm URL builder behaviour.

