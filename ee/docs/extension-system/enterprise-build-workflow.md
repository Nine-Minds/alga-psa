# Enterprise Build Workflow Guide (EE‑Only Wiring)

This guide explains the Enterprise Edition (EE) build workflow relevant to the v2 extension architecture. EE code remains the source of truth for extension services and wiring; the build copies EE sources into the main server where appropriate. The host never injects or serves tenant UI modules; iframe UI assets are served by the Runner.

## Overview

- EE‑only logic (registry, bundles, gateway helpers, install flows) lives under `ee/server/`
- The build script copies EE sources into `server/` for enterprise builds
- No tenant‑supplied code is copied into server filesystem at runtime; extensions are installed from signed, content‑addressed bundles and executed by the Runner
- UI assets are served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` (there is no Next.js route for ext-ui)

## Directory Structure (Updated)

```
alga-psa/
├── ee/server/src/                    # SOURCE (Enterprise Edition)
│   └── lib/extensions/               # Registry, bundles, helpers
├── server/src/                       # TARGET (Main Server)
│   ├── lib/extensions/               # EE helpers + gateway utils
│   └── app/api/ext/                  # API Gateway route to Runner (implemented here)
└── scripts/
    └── build-enterprise.sh           # Build Script
```

Removed/Deprecated paths (should not be copied or (re)introduced):
- Any pages that render tenant JS in the host
- Descriptor rendering code (e.g., ExtensionRenderer.tsx) or descriptor artifacts
- Legacy `/api/extensions/[extensionId]/...` routes that served raw JS modules
- Any Next.js ext-ui route; UI is exclusively served by the Runner

## Build Flow

```
EE Source Files → Build Script → Main Server Files → Application
     ↓               ↓              ↓               ↓
   Edit Here     Copies Files    Do not edit     Runtime
```

## Enterprise Build Script

Location:
```
scripts/build-enterprise.sh
```

The script should:
1) Verify `NEXT_PUBLIC_EDITION=enterprise`
2) Create target directories in `server/src`
3) Copy EE extension modules (registry, bundles, gateway, assets helpers)
4) Skip legacy/removed paths and any UI-serving routes in Next.js

## File Mapping (Updated)

| EE Source                             | Main Server Target                     | Purpose                           |
|---------------------------------------|----------------------------------------|-----------------------------------|
| `ee/server/src/lib/extensions/**`     | `server/src/lib/extensions/**`         | Registry, bundles, helpers        |
| `ee/server/src/app/api/ext/**` (if any templates) | `server/src/app/api/ext/**`   | Gateway (proxy to Runner)         |

## Environment & Config (Phase 0)

Template and document the following in `.env` and EE `.env.example`:
- `RUNNER_BASE_URL` — internal URL used by the gateway to call Runner `POST /v1/execute`
- `RUNNER_PUBLIC_BASE` — public base used to construct ext-ui iframe src
- `EXT_GATEWAY_TIMEOUT_MS` — default timeout for gateway→runner calls
- `EXT_CACHE_ROOT` — optional cache root for server-side helpers (if used)
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_ACCESS_KEY`
- `STORAGE_S3_SECRET_KEY`
- `STORAGE_S3_BUCKET`
- `STORAGE_S3_REGION`
- `STORAGE_S3_FORCE_PATH_STYLE`
- `EXT_BUNDLE_STORE_URL` or equivalent bundle store prefix (if applicable)
- `SIGNING_TRUST_BUNDLE` — trust anchors for signature verification

## Development Workflow

1) Edit EE sources only
```
# Example
vim ee/server/src/lib/extensions/registry-v2.ts
```
2) Run enterprise build
```
NEXT_PUBLIC_EDITION=enterprise ./scripts/build-enterprise.sh
```
3) Build the application (if needed)
```
cd server && NEXT_PUBLIC_EDITION=enterprise npm run build
```

## Common Issues

- Changes disappear: ensure you edited `ee/server/` sources, not `server/`
- Legacy files copied: update the build script to exclude deprecated paths
- Import path errors: prefer relative/shared imports that resolve identically in EE and main
- UI not loading: ensure iframe src uses `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` built via [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38)

## CI/CD Integration

- Run the enterprise build prior to the app build in enterprise pipelines
- Include environment validation and artifact checks

## Notes

- Do not reintroduce any path that uploads or executes tenant code in process
- All extension execution flows must traverse the Gateway and Runner
- UI must be delivered by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` only
- API Gateway route scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)
