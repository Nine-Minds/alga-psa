# Enterprise Extension System v2 Migration Plan (Remove Legacy)

This plan removes the legacy descriptor-based system (never deployed) and finalizes the v2 architecture: API Gateway, iframe-only UI delivery, Manifest v2, and Registry v2. Work is organized into phases with checklists and explicit commit checkpoints to keep the main branch stable.
Status: Completed. All phases executed and guardrails in place.

Key references:
- initializeExtensions(): [ee/server/src/lib/extensions/initialize.ts](ee/server/src/lib/extensions/initialize.ts:5)
- buildExtUiSrc(): [ee/server/src/lib/extensions/ui/iframeBridge.ts](ee/server/src/lib/extensions/ui/iframeBridge.ts:38)
- bootstrapIframe(): [ee/server/src/lib/extensions/ui/iframeBridge.ts](ee/server/src/lib/extensions/ui/iframeBridge.ts:45)
- ExtensionRegistryServiceV2: [ee/server/src/lib/extensions/registry-v2.ts](ee/server/src/lib/extensions/registry-v2.ts:48)
- API Routing Spec Example: [ee/docs/extension-system/api-routing-guide.md](ee/docs/extension-system/api-routing-guide.md)

Terminology and target paths:
- Gateway route: /api/ext/[extensionId]/[[...path]] implemented under [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Iframe UI delivery: served by Runner at ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...] (no Next.js route in ee/server)
- Manifest v2 validator: [ee/server/src/lib/extensions/schemas/manifest-v2.schema.ts](ee/server/src/lib/extensions/schemas/manifest-v2.schema.ts)
- v2-only exports: [ee/server/src/lib/extensions/index.ts](ee/server/src/lib/extensions/index.ts)

---

## Phase 0 — Branch setup and inventory

- [x] Create feature branch for the migration
  - Suggested: `git checkout -b ee/ext-system-v2-only`
- [x] Confirm legacy artifacts to remove (see detailed lists in Phase 2)

Commit checkpoint:
- Commands:
  - `git add -A`
  - `git commit -m "chore(ext): start v2-only migration branch and inventory legacy artifacts"`

---

## Phase 1 — Add v2 primitives (before deleting legacy)

1) API Gateway route scaffold
- [x] Create Next.js route handler: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)
- [x] Implement handler for GET/POST/PUT/PATCH/DELETE:
  - [x] Resolve tenant context from auth/session (RBAC check)
  - [x] Resolve install → active version → content_hash
  - [x] Load manifest v2 for that version and match endpoint by method+path
  - [x] Normalize and proxy to Runner: `POST ${RUNNER_BASE_URL}/v1/execute` (timeout `EXT_GATEWAY_TIMEOUT_MS`)
  - [x] Header allowlist/strip and response mapping per spec: [ee/docs/extension-system/api-routing-guide.md](ee/docs/extension-system/api-routing-guide.md)
  - [x] Correlate with `x-request-id`
- [x] Unit tests:
  - [x] Endpoint resolution (method+path)
  - [x] Header policy (allowlist/strip)
  - [x] Timeout/error mapping (404/413/502/504)

2) Runner UI delivery confirmation
- [x] Confirm Runner serves iframe UI assets at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` (content-addressed, immutable)
- [x] Ensure host URL builder parity: [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) constructs correct src for Runner public base
- [x] Document and enforce immutable cache headers at Runner; only static file types are served
- [x] Do NOT implement a Next.js ext-ui route in ee/server; the Runner is the sole static UI host

3) Manifest v2 validator/types
- [x] Add manifest v2 schema: [ee/server/src/lib/extensions/schemas/manifest-v2.schema.ts](ee/server/src/lib/extensions/schemas/manifest-v2.schema.ts)
  - Fields: `name`, `publisher`, `version`, `runtime`, `capabilities[]`, `ui.type='iframe'` with `entry`, `api.endpoints[]` (method/path/handler), `precompiled`, `assets`, `sbom`
- [x] Wire v2 validation into registry install/publish flow (placeholder until Phase 1.4)
- [x] Export validator/types from index: [ee/server/src/lib/extensions/index.ts](ee/server/src/lib/extensions/index.ts)

4) Minimal Registry v2 wiring to unblock Gateway
- [x] Implement DB-backed methods in ExtensionRegistryServiceV2: [ee/server/src/lib/extensions/registry-v2.ts](ee/server/src/lib/extensions/registry-v2.ts:48)
  - [x] createRegistryEntry, listRegistryEntries, getRegistryEntryByName
  - [x] addVersion (persist `runtime`, `api`, `ui`, `capabilities`)
  - [x] attachBundle (persist `content_hash`, `signature`, `precompiled`)
- [x] Add install resolution helpers (tenant → install → active version + content_hash)
- [x] Signature shape validation stub; store signature (full verification in Phase 3)

5) v2-first exports
- [x] Update index to export only v2 interfaces and helpers (leave legacy in place for now, but stop re-exporting where possible):
  - Stop new consumers from importing legacy modules
  - Export: Manifest v2 validator/types, ExtensionRegistryServiceV2, iframeBridge
  - File: [ee/server/src/lib/extensions/index.ts](ee/server/src/lib/extensions/index.ts)

Commit checkpoint:
- Commands:
  - `git add ee/server/src/app/api/ext ee/server/src/app/ext-ui ee/server/src/lib/extensions/schemas/manifest-v2.schema.ts ee/server/src/lib/extensions/index.ts ee/server/src/lib/extensions/registry-v2.ts`
  - `git commit -m "feat(ext-v2): add gateway scaffold, ext-ui route, manifest v2 validator, minimal registry wiring"`

---

## Phase 2 — Remove legacy codepaths and fallbacks

A) Remove descriptor-based UI pipeline and security whitelist
- [x] Delete descriptor renderer and descriptors:
  - [ee/server/src/lib/extensions/ui/DescriptorRenderer.tsx](ee/server/src/lib/extensions/ui/DescriptorRenderer.tsx)
  - [ee/server/src/lib/extensions/ui/descriptors](ee/server/src/lib/extensions/ui/descriptors)
- [x] Delete pages/tabs/navigation legacy UI:
  - [ee/server/src/lib/extensions/ui/pages](ee/server/src/lib/extensions/ui/pages)
  - [ee/server/src/lib/extensions/ui/tabs](ee/server/src/lib/extensions/ui/tabs)
  - [ee/server/src/lib/extensions/ui/navigation](ee/server/src/lib/extensions/ui/navigation)
- [x] Delete security whitelist:
  - [ee/server/src/lib/extensions/security/propWhitelist.ts](ee/server/src/lib/extensions/security/propWhitelist.ts)
- [x] Remove re-exports from:
  - [ee/server/src/lib/extensions/ui/index.ts](ee/server/src/lib/extensions/ui/index.ts)

B) Remove renderer, routers, server actions, hooks, dev/mock route
- [x] Replace/remove legacy renderer:
  - [ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx](ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx)
  - Migrate any callsites to iframe embed flow (using buildExtUiSrc() + bootstrapIframe())
- [x] Delete legacy router:
  - [ee/server/src/lib/extensions/routing/ExtensionRouter.tsx](ee/server/src/lib/extensions/routing/ExtensionRouter.tsx)
- [x] Delete server action for descriptor loads:
  - [ee/server/src/lib/actions/extension-actions/extensionActions.ts](ee/server/src/lib/actions/extension-actions/extensionActions.ts)
- [x] Delete dev/mock hook:
  - [ee/server/src/hooks/useExtensions.ts](ee/server/src/hooks/useExtensions.ts)
- [x] Delete dev/mock API route:
  - [ee/server/src/app/api/extensions/route.ts](ee/server/src/app/api/extensions/route.ts)

C) Remove MSP descriptor-based page and replace with iframe page (or remove)
- [x] Delete or replace page:
  - [ee/server/src/app/msp/extensions/[extensionId]/[...path]/page.tsx](ee/server/src/app/msp/extensions/%5BextensionId%5D/%5B...path%5D/page.tsx)
  - If retained, render a sandboxed iframe using buildExtUiSrc() and bootstrapIframe()

D) Remove legacy schemas/validators/types
- [x] Delete legacy manifest schema and extension points:
  - [ee/server/src/lib/extensions/schemas/manifest.schema.ts](ee/server/src/lib/extensions/schemas/manifest.schema.ts)
  - [ee/server/src/lib/extensions/schemas/extension-points.schema.ts](ee/server/src/lib/extensions/schemas/extension-points.schema.ts)
- [x] Delete legacy validator helpers:
  - [ee/server/src/lib/extensions/validator.ts](ee/server/src/lib/extensions/validator.ts)
- [x] Prune v1 UI component types from:
  - [ee/server/src/lib/extensions/types.ts](ee/server/src/lib/extensions/types.ts)
  - Remove `ExtensionComponentType` and Tab/Navigation/Dashboard/CustomPage types; keep only shared DB models still used

E) Delete prototypes/POCs
- [x] Remove disregard prototype:
  - [ee/server/src/disregard-pgs/ext/[...path].tsx](ee/server/src/disregard-pgs/ext/%5B...path%5D.tsx)

Commit checkpoint:
- Commands:
  - `git rm -r ee/server/src/lib/extensions/ui/descriptors ee/server/src/lib/extensions/ui/pages ee/server/src/lib/extensions/ui/tabs ee/server/src/lib/extensions/ui/navigation`
  - `git rm ee/server/src/lib/extensions/ui/DescriptorRenderer.tsx ee/server/src/lib/extensions/security/propWhitelist.ts`
  - `git rm ee/server/src/lib/extensions/routing/ExtensionRouter.tsx ee/server/src/lib/actions/extension-actions/extensionActions.ts ee/server/src/hooks/useExtensions.ts`
  - `git rm ee/server/src/app/api/extensions/route.ts ee/server/src/app/msp/extensions/[extensionId]/[...path]/page.tsx`
  - `git rm ee/server/src/lib/extensions/schemas/manifest.schema.ts ee/server/src/lib/extensions/schemas/extension-points.schema.ts ee/server/src/lib/extensions/validator.ts`
  - `git rm ee/server/src/disregard-pgs/ext/[...path].tsx`
  - Edit and stage `ee/server/src/lib/extensions/ui/index.ts`, `ee/server/src/lib/extensions/ui/ExtensionRenderer.tsx`, `ee/server/src/lib/extensions/types.ts`
  - `git add -A`
  - `git commit -m "refactor(ext-v2): remove legacy descriptor-based UI, schemas, routes, and fallbacks"`

---

## Phase 3 — Finalize v2 enforcement and security

- [x] Implement full signature verification on bundle publish/install:
  - Trust bundle env (e.g., `SIGNING_TRUST_BUNDLE`)
  - Verify detached signature and `content_hash` on install and load
- [x] Enforce capability grants on Runner invocation (gateway enforces)
- [x] Enforce egress allowlists for http.fetch
- [x] Harden gateway limits and timeouts per spec

Commit checkpoint:
- `git add -A && git commit -m "feat(ext-v2): signature verification, capability grants, egress allowlists, gateway limits"`

---

## Phase 4 — Docs to v2-only (remove legacy references and interim banners)

- [x] Rewrite the following to present v2 as the only system:
  - [ee/docs/extension-system/overview.md](ee/docs/extension-system/overview.md)
  - [ee/docs/extension-system/manifest_schema.md](ee/docs/extension-system/manifest_schema.md)
  - [ee/docs/extension-system/api-routing-guide.md](ee/docs/extension-system/api-routing-guide.md)
  - [ee/docs/extension-system/serving-system.md](ee/docs/extension-system/serving-system.md)
  - [ee/docs/extension-system/security_signing.md](ee/docs/extension-system/security_signing.md)
  - [ee/docs/extension-system/development_guide.md](ee/docs/extension-system/development_guide.md)
- [x] Remove status banners and any legacy descriptor references
- [x] Update or remove example docs under [ee/docs/examples](ee/docs/examples) that rely on descriptors

Commit checkpoint:
- `git add -A && git commit -m "docs(ext-v2): finalize v2-only docs; remove legacy references and interim banners"`

---

## Phase 5 — Guardrails and repo-wide cleanup

- [x] Global search to ensure no references remain:
  - Patterns: `"descriptors/pages/"`, `"DescriptorRenderer"`, `"TabExtensionSlot"`, `"NavigationRegistry"`, `"PageRegistry"`, `"loadExtensionDescriptor"`
- [x] Add ESLint custom rule (eslint-plugin-custom-rules) to ban imports from:
  - `ee/server/src/lib/extensions/ui/descriptors/*`
  - `ee/server/src/lib/extensions/ui/pages/*`
  - `ee/server/src/lib/extensions/ui/tabs/*`
  - `ee/server/src/lib/extensions/ui/navigation/*`
  - `ee/server/src/lib/extensions/security/propWhitelist.ts`
  - `ee/server/src/lib/extensions/schemas/manifest.schema.ts`
  - `ee/server/src/lib/extensions/validator.ts`
- [x] CI grep step to fail on banned paths (defense-in-depth)

Commit checkpoint:
- `git add -A && git commit -m "chore(ext-v2): add lint/CI guardrails to prevent legacy imports"`

---

## Phase 6 — Tests and verification

Unit tests:
- [x] Manifest v2 validator accept/reject test matrix
- [x] Gateway header allowlist/strip, path resolution, timeouts/errors

Integration (with mocked Runner /v1/execute):
- [x] 200/404/413/502/504 response mappings and headers
- [x] Correlation IDs propagated
- [x] ext-ui route serves by `content_hash` with immutable caching and correct MIME types
  - URL parity with builder: [ee/server/src/lib/extensions/ui/iframeBridge.ts](ee/server/src/lib/extensions/ui/iframeBridge.ts)

Build and typing:
- [x] `tsc` clean
- [x] `next build` passes
- [x] Lint passes with new guardrails

Commit checkpoint:
- `git add -A && git commit -m "test(ext-v2): unit+integration tests; build/lint/type verification"`

---

## Post-migration: Developer guidance and examples

- [x] Update example extension template to v2 layout
  - WASM handlers, iframe UI app, manifest v2, signed bundle
  - Demonstrate gateway calls from UI to `/api/ext/{extensionId}/...`
- [x] Remove any descriptor JSON assets from examples
- [x] Reference SDKs where applicable:
  - `@alga/extension-iframe-sdk` and `@alga/ui-kit` (document usage and minimal example)

Commit checkpoint:
- `git add -A && git commit -m "docs/examples(ext-v2): v2 example extension; remove legacy descriptor assets"`

---

## Notes and risks

- Breakage risk stems from lingering imports/types; mitigated by phased deletes, repo-wide searches, and ESLint/CI bans.
- Keep the gateway’s Runner request/response mapping in a dedicated helper to accommodate Runner interface evolution.
- Ensure server ext-ui route path composition mirrors buildExtUiSrc() to avoid drift.

---

## Appendix A — Quick command snippets

Create branches, add, and commit:
```
git checkout -b ee/ext-system-v2-only
git add -A
git commit -m "message"
```

Grep checks (local preflight):
```
git grep -n "DescriptorRenderer\|descriptors/pages/\|TabExtensionSlot\|NavigationRegistry\|PageRegistry\|loadExtensionDescriptor" -- "ee/server" || true
```

---

## Appendix B — Canonical references

- initializeExtensions(): [ee/server/src/lib/extensions/initialize.ts](ee/server/src/lib/extensions/initialize.ts:5)
- buildExtUiSrc(): [ee/server/src/lib/extensions/ui/iframeBridge.ts](ee/server/src/lib/extensions/ui/iframeBridge.ts:38)
- bootstrapIframe(): [ee/server/src/lib/extensions/ui/iframeBridge.ts](ee/server/src/lib/extensions/ui/iframeBridge.ts:45)
- ExtensionRegistryServiceV2: [ee/server/src/lib/extensions/registry-v2.ts](ee/server/src/lib/extensions/registry-v2.ts:48)
- API Routing Spec Example: [ee/docs/extension-system/api-routing-guide.md](ee/docs/extension-system/api-routing-guide.md)
