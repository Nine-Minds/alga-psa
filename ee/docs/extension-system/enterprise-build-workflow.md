# Enterprise Build Workflow Guide (EE‑Only Wiring)

This guide explains the Enterprise Edition (EE) build workflow relevant to the new extension architecture. EE code remains the source of truth for extension services and wiring; the build copies EE sources into the main server where appropriate. Legacy in‑process UI rendering and descriptor artifacts are deprecated and no longer part of the build.

## Overview

- EE‑only logic (registry, bundles, gateway helpers, install flows) lives under `ee/server/`
- The build script copies EE sources into `server/` for enterprise builds
- No tenant‑supplied code is copied into server filesystem at runtime; extensions are installed from signed bundles

## Directory Structure (Updated)

```
alga-psa/
├── ee/server/src/                    # SOURCE (Enterprise Edition)
│   └── lib/extensions/               # Registry, bundles, helpers, assets cache
├── server/src/                       # TARGET (Main Server)
│   ├── lib/extensions/               # EE helpers + server-side assets/gateway utils
│   ├── app/api/ext/                  # Gateway route to Runner (implemented here)
│   └── app/ext-ui/                   # Iframe UI asset route (implemented here)
└── scripts/
    └── build-enterprise.sh           # Build Script
```

Deprecated paths (should not be copied anymore):
- `app/msp/extensions/...` pages that render tenant JS in host
- `ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx` and descriptor rendering code
- `/api/extensions/[extensionId]/...` routes that serve raw JS modules

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
3) Copy EE extension modules (registry, bundles, gateway, assets)
4) Skip legacy/removed paths

## File Mapping (Updated)

| EE Source                                   | Main Server Target                         | Purpose                            |
|---------------------------------------------|--------------------------------------------|------------------------------------|
| `ee/server/src/lib/extensions/**`           | `server/src/lib/extensions/**`             | Registry, bundles, cache, helpers  |

## Environment & Config (Phase 0)

Template and document the following in `.env` and EE `.env.example`:
- `EXT_BUNDLE_STORE_URL`
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_ACCESS_KEY`
- `STORAGE_S3_SECRET_KEY`
- `STORAGE_S3_BUCKET`
- `STORAGE_S3_REGION`
- `STORAGE_S3_FORCE_PATH_STYLE`
- `EXT_CACHE_ROOT`
- `RUNNER_BASE_URL`
- `EXT_GATEWAY_TIMEOUT_MS`

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

## CI/CD Integration

- Run the enterprise build prior to the app build in enterprise pipelines
- Include environment validation and artifact checks

## Notes

- Do not reintroduce any path that uploads or executes tenant code in process
- All extension execution flows must traverse the gateway and Runner
- UI must be delivered via `/ext-ui/{extensionId}/{content_hash}/...` only
