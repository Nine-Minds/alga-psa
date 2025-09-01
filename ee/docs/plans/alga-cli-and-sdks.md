# Alga CLI and SDKs – NPM Publishing Plan

Note on paths: unless stated otherwise, file paths referenced for recent changes are relative to `ee/server`.

## Overview
Goal: Ship an official CLI and SDKs so partners can build and publish Alga client extensions easily. Start with the client SDK and CLI, then add API SDKs. Keep packages modular and composable, with an optional meta entry point.

## Package Taxonomy
- @alga-psa/cli: Top-level CLI (bin: `alga`). Aggregates commands from sub‑SDKs.
- @alga-psa/client-sdk: Programmatic + CLI utilities for client extension development (scaffold, pack, sign, publish).
- @alga-psa/extension-iframe-sdk: Runtime bridge for iframe‑hosted extensions (existing code; ensure final package.json + build).
- @alga-psa/ui-kit: Design tokens + UI primitives for extensions (present; consider renaming scope to `@alga-psa/ui-kit`).
- @alga-psa/api-sdk (future): HTTP client for Alga APIs.
- @alga-psa/all (optional): Meta package pulling in cli, client-sdk, ui-kit, api-sdk.

## Workspace Layout
- Monorepo workspaces: `sdk/*` (preferred for developer SDKs/CLI) and `packages/*` (generic libs).
- Recommendation: Place client‑facing developer tooling in `sdk/`:
  - `sdk/alga-client-sdk` (programmatic SDK + commands)
  - `sdk/alga-cli` (thin CLI wrapper delegating to client‑sdk)
  - `sdk/extension-iframe-sdk` (runtime bridge; move from `packages/` for consistency)
  - Keep non‑SDK libraries (e.g., UI tokens) under `packages/`.

## Initial Scope (Phase 1)
1) Scaffold @alga-psa/client-sdk
   - Commands (programmatic + thin CLI wrappers):
     - create extension (scaffold from templates)
     - pack (zip/build artifacts)
     - sign (optional; dev key support)
     - publish (to Alga registry)
   - Templates bundled under `templates/*` and copied at scaffold time.
   - Expose functions: `createNewProject`, `createUiProject`, `packProject`, `sign`, `publish`.

2) Scaffold @alga-psa/cli
   - `bin: { "alga": "dist/cli.js" }`.
   - Delegates to `@alga-psa/client-sdk` commands.
   - Commands: `alga create extension`, `alga pack`, `alga publish`, `alga sign`.

3) Ship @alga-psa/extension-iframe-sdk
   - Ensure `package.json`, `exports`, `types`, and build output.

4) UI Kit
   - If public: rename to `@alga-psa/ui-kit`. Publish tokens + primitives. Keep CSS tokens accessible via exports.

## Conventions
- TypeScript per package: Node 18+, ESM (`module: ESNext`, `moduleResolution: bundler|nodenext`).
- Library packages: `exports: { ".": "./dist/index.js" }`, `types: "./dist/index.d.ts"`, `files: ["dist", ...assets]`.
- CLI package: `bin: { "alga": "./dist/cli.js" }`, `type: "module"`.
- Scripts: `build` (tsc), `prepublishOnly` (build), `lint`, `test`.
- Templates: shipped inside client-sdk; avoid network fetch during `create`.

## Release Strategy
- Initial public releases:
  - `@alga-psa/client-sdk@0.1.0`
  - `@alga-psa/cli@0.1.0` (depends on client-sdk)
  - `@alga-psa/extension-iframe-sdk@0.x`
  - `@alga-psa/ui-kit@0.x` (public/private per decision)
- Pre‑releases: publish with `--tag next` while stabilizing.
- Versioning: start manual; adopt Changesets later for coordinated bumps.

## Roadmap
- Phase 1 (this PR): client-sdk + CLI, iframe-sdk packaging, optional ui-kit scope alignment.
- Phase 2: API SDK (`@alga-psa/api-sdk`) with typed clients, auth helpers.
- Phase 3: Meta package `@alga-psa/all` (optional); improve CLI plugin architecture for additional SDKs.

## Next Actions
- Consolidate layout under `sdk/` for developer tooling:
  - Move `ee/server/packages/alga-client-sdk` → `sdk/alga-client-sdk` (replace older skeleton if needed).
  - Move `ee/server/packages/alga-cli` → `sdk/alga-cli`.
  - Move `packages/extension-iframe-sdk` → `sdk/extension-iframe-sdk` (or keep in `packages/` if we prefer that split).
- Ensure root `package.json` workspaces include `sdk/*` (already present) and keep `packages/*` for generic libs.
- Add build scripts and `publishConfig: { access: "public" }` where appropriate.
- Normalize scopes (rename `@alga/ui-kit` → `@alga-psa/ui-kit` if public).
- Author READMEs with quickstart:
  - `npx @alga-psa/cli create extension`.
  - Programmatic examples for client-sdk.

## Notes
- Keep logic in SDKs; keep CLI thin. This prevents duplication as more SDKs land.
- Bundle only what’s needed in npm (`files` field) to keep packages lean.
