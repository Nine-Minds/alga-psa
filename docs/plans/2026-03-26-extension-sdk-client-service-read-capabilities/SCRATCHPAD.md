# Scratchpad — 2026-03-26 extension SDK client/service read capabilities

## Discoveries
- Plan checklist files were fully `implemented:false`; no pre-existing `SCRATCHPAD.md` existed.
- Existing extension host surface supports context/secrets/http/storage/logging/ui-proxy/user/scheduler/invoicing but not client/service reads.
- Capability registries currently live in:
  - `ee/server/src/lib/extensions/providers.ts`
  - `ee/runner/src/providers/mod.rs`
- Internal runner-backed APIs already exist as pattern references:
  - `ee/server/src/app/api/internal/ext-scheduler/install/[installId]/route.ts`
  - `ee/server/src/app/api/internal/ext-invoicing/install/[installId]/route.ts`
  - `ee/server/src/lib/extensions/invoicingInternalApi.ts`
- Runner host provider implementation is centralized in:
  - `ee/runner/src/engine/host_api.rs`
- SDK runtime host typings/mocks are in:
  - `sdk/extension-runtime/src/index.ts`

## Decisions
- Reuse scheduler/invoicing architecture for new client/service reads: install-scoped internal endpoints called by runner capability provider.
- Keep tenant scope derived from install config + runner context only (no tenant inputs exposed in WIT).
- Add shared EE server read services for client/service summaries instead of calling server actions with `withAuth` wrappers.

## Next Work
- Add new capabilities + WIT interfaces + TS runtime bindings/mocks.
- Implement server internal APIs for clients/services list/get with RBAC/capability checks.
- Wire Rust runner providers and add tests.

## Commands Run
- `rg` scans for current capabilities and host surfaces.
- `sed` inspections for WIT/runtime/provider/internal API files.

## Implemented
- Added provider capabilities for client/service reads in EE server + runner:
  - `cap:client.read`
  - `cap:service.read`
- Extended runner and template WIT contracts with:
  - `clients.list-clients`, `clients.get-client`
  - `services.list-services`, `services.get-service`
  - summary/list records + stable error enums (`not-allowed`, `invalid-input`, `internal`).
- Extended `sdk/extension-runtime` host bindings/mocks with typed:
  - `host.clients.list/get`
  - `host.services.list/get`
- Added EE server shared read services:
  - `ee/server/src/lib/extensions/clientReadService.ts`
  - `ee/server/src/lib/extensions/serviceReadService.ts`
- Added EE server internal APIs and routes:
  - `ee/server/src/lib/extensions/clientsInternalApi.ts`
  - `ee/server/src/lib/extensions/servicesInternalApi.ts`
  - `ee/server/src/app/api/internal/ext-clients/install/[installId]/route.ts`
  - `ee/server/src/app/api/internal/ext-services/install/[installId]/route.ts`
- Added runner host provider wiring for clients/services in:
  - `ee/runner/src/engine/host_api.rs`
  including capability checks, non-user support, user RBAC forwarding, input validation, nullable get handling, tenant-scoped install routing, and structured logs.
- Added sample extension:
  - `sdk/samples/component/client-service-read-demo`
  demonstrating direct host list calls and ui-proxy summary parity.

## Tests Added/Updated
- `sdk/extension-runtime/src/wit-contract.test.ts` (T001/T002)
- `sdk/extension-runtime/src/runtime.test.ts` (T003/T004)
- `ee/server/src/__tests__/unit/clientsInternalApi.unit.test.ts` (T005/T007/T008/T011/T013/T017/T019/T021)
- `ee/server/src/__tests__/unit/servicesInternalApi.unit.test.ts` (T006/T009/T010/T012/T014/T018/T020/T022)
- `ee/server/src/__tests__/unit/clientReadService.mapper.unit.test.ts` (T015)
- `ee/server/src/__tests__/unit/serviceReadService.mapper.unit.test.ts` (T016)
- `sdk/samples/component/client-service-read-demo/src/handler.test.ts` (T023/T024/T025)

## Validation Runbook
- `cd ee/runner && cargo test -q`
- `cd ee/server && npx vitest run --coverage.enabled=false src/__tests__/unit/invoicingInternalApi.unit.test.ts src/__tests__/unit/clientsInternalApi.unit.test.ts src/__tests__/unit/servicesInternalApi.unit.test.ts src/__tests__/unit/clientReadService.mapper.unit.test.ts src/__tests__/unit/serviceReadService.mapper.unit.test.ts`
- `cd sdk/extension-runtime && npx vitest run --coverage.enabled=false`
- `cd sdk/samples/component/client-service-read-demo && npx vitest run --coverage.enabled=false`

## Gotchas
- Workspace Vitest coverage temp-path handling caused ENOENT during package-local runs; used `--coverage.enabled=false` for targeted package test commands.
- EE test alias resolution required using `server/src/lib/db` import path from new read services for Vitest compatibility.
