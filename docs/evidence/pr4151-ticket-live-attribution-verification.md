# PR #4151 ticket live attribution verification

## Current revision

Source under verification: the repair commit recorded below.

## Automated verification

Focused commands and results:

- From `packages/tickets`: `npx vitest run src/lib/liveUpdates.test.ts src/hooks/useTicketLive.test.tsx` — passed, 17 tests. The publisher test inspects the serialized Redis JSON: foreign user UUIDs and unexpected fields are absent, expected opaque reference/display data remains, invalid ownership and actor combinations are rejected, and local user IDs remain available.
- Mutation check: temporarily bypassed `projectTicketLiveUpdateActor` at the publication boundary and ran `npx vitest run src/lib/liveUpdates.test.ts -t 'serializes only the public actor contract'` — failed as expected because the serialized actor contained the foreign UUID, untrusted label, and injected fields. Restored the projection; the focused suite passed afterward.
- From `server`: `npx vitest run src/test/unit/hocuspocus/TicketUpdatesExtension.test.ts` — passed, 3 tests. This exercises the production Redis forwarding extension with a harness; it does not establish authenticated customer-browser receipt.
- From `packages/tickets`: `npm run typecheck` — passed.
- From `packages/event-schemas`: `npm run typecheck && npm run build` — passed.
- From `packages/co-managed`: `npm run typecheck` — passed.
- From `packages/tickets`: `npm run build` is not configured with tsup inputs and exits with `No input files`; the package typecheck passed.
- From `server`: `npm run typecheck` exceeded Node's default heap (about 4 GiB). `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` also exhausted the 8 GiB heap after about 2.5 minutes, without TypeScript diagnostics. This is a resource-limited workspace-wide check; package-level checks for the changed implementation passed.

The server was intentionally left stopped. No live smoke, app startup, admission request, or production review app was performed in this repair.

Repair commit: `3ebc4a9fe4b8d4eb76e1947ea6f875a41fcab36d`.

## Attribution path checked

`ensureCoManagedActorReference` persists or reloads the stable handle under the owner tenant's `collaboration_actor_references` table, keyed by owner tenant, source tenant, and source user. `sharedTicketCommentWriter` reloads that internal reference for workflow/audit records, retaining its source user identifier. Its live update is handed to `publishTicketUpdate`, where `projectTicketLiveUpdateActor` validates the internal reference and constructs a public actor before `JSON.stringify`. The public reference allowlist contains only `ownerTenantId`, `tenantId`, `referenceId`, `displayName`, and `organizationName`; both internal and public schemas reject malformed shapes, and publication enforces owner tenant equality and cross-tenant identity. Local attribution remains `{ userId, displayName }`.

The Redis forwarding extension broadcasts the parsed JSON unchanged to the matching Hocuspocus ticket document. `useTicketLive` parses incoming stateless updates using the production actor parser; automated hook tests exercise this parsing path. These tests do not establish an authenticated customer's browser receiving a WebSocket frame.

## Historical live smoke

Artifacts at `/tmp/alga-smoke-evidence/tenant-scoping-20261103-0630` record real UI comment creation, persistence, Redis payloads, internal actor-reference persistence, and a local-user update on 2026-11-03. The artifact README and walkthrough do not identify a source revision. Treat this as historical smoke evidence, not evidence for the current revision. The evidence also explicitly says customer-browser receipt and the named security-finding-resolved check were not captured/run.

## Remaining verification

- Current-revision authenticated live smoke is incomplete because the app server is deliberately stopped for this assignment.
- Authenticated customer-browser WebSocket receipt remains unverified.
- No authoritative definition or executable for `security-finding-resolved` was found in repository searches across `.github`, `docs`, `scripts`, `tools`, and the affected packages; the check is unavailable here and no substitute is claimed.
- Recheck these gaps after the pushed revision is available in the authorized live-smoke environment. Do not treat the automated checks above as approval readiness.
