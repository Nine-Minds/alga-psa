# Client Extension System Implementation Scratchpad (Overhaul)

This scratchpad tracks near‑term tasks for the multi‑tenant overhaul. Legacy, in‑process UI/descriptor notes have been removed.

## Current Focus
- Phase 0: EE‑only wiring + env templates
- Phase 1: Migrations + registry/install services + signature verification
- Phase 2: Bundle storage helpers (S3/MinIO)
- Phase 4: API gateway route + helpers

## Checklists

### Phase 0
- [ ] Confirm extension init is EE‑only in builds
- [ ] Add `.env.example` with EXT_* and STORAGE_* vars
- [ ] Define cache root permissions and default limits

### Phase 1
- [ ] Draft migrations: registry, version, bundle, install, events, exec log, quotas
- [ ] Signature verification utility (trust bundle)
- [ ] Registry service (publish/list/get; version metadata incl. `content_hash`, `signature`)
- [ ] Tenant install service (enable/disable; `granted_caps`, `config`)

### Phase 2
- [ ] S3 provider integration against MinIO
- [ ] `getBundleStream`, `getBundleIndex`, `extractSubtree` for `dist/` and `ui/`
- [ ] Precompiled artifacts (optional) resolution

### Phase 4
- [ ] `/api/ext/[extensionId]/[[...path]]` route
- [ ] Helpers: auth/tenant resolution, endpoint matcher, header filters
- [ ] Proxy to Runner with timeouts/retries and header allowlist

## Notes
- No tenant code executes in the app process
- UI is iframe‑only via `/ext-ui/{extensionId}/{content_hash}/...`
- All execution flows go through Runner

## References
- [Implementation Plan](implementation_plan.md)
- [API Routing Guide](api-routing-guide.md)
- [Security & Signing](security_signing.md)
- [Registry Implementation](registry_implementation.md)
