# Scratchpad — Inbound Email Sender Routing to Boards

- Plan slug: `inbound-email-sender-routing-to-boards`
- Created: `2026-02-25`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also update earlier notes when a decision changes or an open question is resolved.

## Decisions

- (2026-02-25) Revised plan ownership from provider-level sender-rule table to client/contact-owned routing configuration.
- (2026-02-25) Destination target stays as `inbound_ticket_defaults_id` (profile-level), not board-only override.
- (2026-02-25) Precedence for new-ticket creation: contact override -> client destination -> provider default.
- (2026-02-25) Existing-ticket reply flows remain unchanged; no rerouting for threaded replies.
- (2026-02-25) `F001` completed as a plan-model checkpoint: implementation work proceeds only with client/contact-owned routing and does not introduce provider-level sender-rule tables.
- (2026-02-25) Shared resolver `resolveEffectiveInboundTicketDefaults` is the single precedence source for contact override / contact-client default / provider fallback used by both in-app and runtime context paths.
- (2026-02-25) Domain-matched client routing now contributes to destination resolution via the same shared resolver (`client_default_from_domain` before provider fallback).
- (2026-02-25) Destination IDs from contacts/clients are runtime-validated against `inbound_ticket_defaults` with `(tenant, id, is_active=true)` before use; invalid/inactive mappings now warn and fallback.

## Discoveries / Constraints

- (2026-02-25) Existing sender-domain-to-client mapping already exists and is explicit via `client_inbound_email_domains`.
- (2026-02-25) `processInboundEmailInApp` currently sets ticket board from provider defaults (`defaults.board_id`) and does not vary by sender.
- (2026-02-25) `resolve_inbound_ticket_context` currently resolves target client/contact/location only; it does not yet compute sender-based destination defaults.
- (2026-02-25) `ClientDetails` already includes inbound-domain and default-contact controls, making client-level destination a natural extension.
- (2026-02-25) `clients` currently had no dedicated inbound destination field; persisted client destination now starts with nullable `clients.inbound_ticket_defaults_id`.
- (2026-02-25) `contacts` currently had no dedicated inbound destination override; persisted contact override now starts with nullable `contacts.inbound_ticket_defaults_id`.
- (2026-02-25) Added explicit tenant-scoped indexes for lookup safety/perf:
  - `idx_clients_tenant_inbound_ticket_defaults`
  - `idx_contacts_tenant_inbound_ticket_defaults`
- (2026-02-25) Local worktree currently has no installed npm dependencies (`npm ls vitest --depth=0` is empty), so targeted Vitest runs fail at startup before test execution.

## Commands / Runbooks

- (2026-02-25) Read current inbound processing and context resolution:
  - `rg -n "processInboundEmailInApp|resolve_inbound_ticket_context|resolveInboundTicketDefaults" shared/services/email shared/workflow`
- (2026-02-25) Read existing domain-match plans and tests:
  - `ee/docs/plans/2026-02-13-inbound-email-domain-matching-default-contact/`
  - `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`
  - `server/src/test/integration/resolveInboundTicketContext.domainFallback.integration.test.ts`
- (2026-02-25) Scaffold and validate plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Inbound Email Sender Routing to Boards" --slug inbound-email-sender-routing-to-boards`
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-25-inbound-email-sender-routing-to-boards`
- (2026-02-25) Add client destination schema migration:
  - `server/migrations/20260225120000_add_client_inbound_ticket_defaults_id.cjs`
- (2026-02-25) Add contact override schema migration:
  - `server/migrations/20260225120500_add_contact_inbound_ticket_defaults_id.cjs`
- (2026-02-25) Add lookup index migration:
  - `server/migrations/20260225121000_add_inbound_ticket_defaults_lookup_indexes.cjs`
- (2026-02-25) Targeted unit tests attempted for shared/runtime email routing changes:
  - `npx vitest run shared/services/email/__tests__/processInboundEmailInApp.test.ts shared/services/email/__tests__/processInboundEmailInApp.additionalPaths.test.ts shared/workflow/runtime/actions/__tests__/registerEmailWorkflowActions.contactAuthorship.test.ts`
  - Blocker in local env: Vitest startup fails because `dotenv` package is missing from active node_modules resolution path.
- (2026-02-25) Targeted migration integration test attempted:
  - `cd server && npx vitest run src/test/integration/inboundTicketDestinationMigrations.integration.test.ts --reporter=dot`
  - Blocker in local env: Vitest startup fails because `vitest` package is not installed in this worktree.
- (2026-02-25) Targeted in-app routing integration test attempted:
  - `cd server && npx vitest run src/test/integration/inboundEmailInApp.webhooks.integration.test.ts --reporter=dot`
  - Blocker in local env: Vitest startup fails because `vitest` package is not installed in this worktree.
- (2026-02-25) Targeted workflow destination routing integration test attempted:
  - `cd server && npx vitest run src/test/integration/resolveInboundTicketContext.destinationRouting.integration.test.ts --reporter=dot`
  - Blocker in local env: Vitest startup fails because `vitest` package is not installed in this worktree.
- (2026-02-25) Targeted resolver unit test attempted:
  - `npx vitest run shared/workflow/actions/__tests__/emailWorkflowActions.destinationResolver.test.ts --reporter=dot`
  - Blocker in local env: Vitest startup fails because `dotenv` package is missing from active root node_modules resolution path.
- (2026-02-25) Targeted clients actions unit test attempted:
  - `npx vitest run packages/clients/src/actions/inboundTicketDestinationActions.test.ts --reporter=dot`
  - Blocker in local env: Vitest startup fails because `dotenv` package is missing from active root node_modules resolution path.
- (2026-02-25) Targeted ClientDetails inbound destination wiring test attempted:
  - `npx vitest run packages/clients/src/components/clients/ClientDetails.inboundDestination.wiring.test.ts --reporter=dot`
  - Blocker in local env: Vitest startup fails because `dotenv` package is missing from active root node_modules resolution path.
- (2026-02-25) Targeted ContactDetails inbound destination wiring test attempted:
  - `npx vitest run packages/clients/src/components/contacts/ContactDetails.inboundDestination.wiring.test.ts --reporter=dot`
  - Blocker in local env: Vitest startup fails because `dotenv` package is missing from active root node_modules resolution path.

## Links / References

- In-app inbound pipeline:
  - `shared/services/email/processInboundEmailInApp.ts`
- Workflow action registration and context resolution:
  - `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`
- Shared email workflow actions:
  - `shared/workflow/actions/emailWorkflowActions.ts`
- Existing client inbound domain actions:
  - `packages/clients/src/actions/clientInboundEmailDomainActions.ts`
- New inbound destination actions:
  - `packages/clients/src/actions/inboundTicketDestinationActions.ts`
- Client details UI:
  - `packages/clients/src/components/clients/ClientDetails.tsx`
- Contact UI surfaces:
  - `packages/clients/src/components/contacts/*`

## Open Questions

- Should client/contact destination be global, or optionally provider-specific for tenants with multiple inbound mailboxes?
- Should UI block selecting inactive defaults profiles, or allow save and rely on runtime fallback?
- Should contact override be shown only when contact has a valid email value?

## Implementation Log

- (2026-02-25) Marked `F001` implemented in `features.json` and committed as the first checklist checkpoint.
- (2026-02-25) Completed `F002` by adding migration `20260225120000_add_client_inbound_ticket_defaults_id.cjs` to persist `clients.inbound_ticket_defaults_id`.
- (2026-02-25) Completed `F003` by adding migration `20260225120500_add_contact_inbound_ticket_defaults_id.cjs` to persist `contacts.inbound_ticket_defaults_id`.
- (2026-02-25) Completed `F004` by adding migration `20260225121000_add_inbound_ticket_defaults_lookup_indexes.cjs` with safe create/drop index behavior.
- (2026-02-25) Completed `F005` by adding shared resolver logic in `shared/workflow/actions/emailWorkflowActions.ts` and wiring it into:
  - `shared/services/email/processInboundEmailInApp.ts`
  - `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`
- (2026-02-25) Completed `F006` by passing domain-matched client context into the shared resolver in both in-app and workflow-runtime paths.
- (2026-02-25) Completed `F007` by enforcing tenant+active validation on contact/client destination IDs before applying defaults.
- (2026-02-25) Completed `F008` by using shared destination resolution in `processInboundEmailInApp` before new-ticket create, while preserving existing reply-token/thread branches.
- (2026-02-25) Completed `F009` by using the same shared destination resolver in `resolve_inbound_ticket_context` (runtime v2 action registry) for parity with in-app processing.
- (2026-02-25) Completed `F010` by keeping reply-token/thread-header branches untouched; only new-ticket destination selection path was changed.
- (2026-02-25) Completed `F011` by retaining existing sender identity matching semantics:
  - exact contact remains the only source for comment authorship
  - domain matching remains explicit via `client_inbound_email_domains`
- (2026-02-25) Completed `F012` by adding server actions for inbound destination option reads and client destination updates with explicit client permission checks.
- (2026-02-25) Completed `F013` by adding contact destination update action with explicit contact permission checks and tenant-scoped destination validation.
- (2026-02-25) Completed `F014` by adding an inbound ticket destination selector to `ClientDetails` with clear-to-provider-default behavior.
- (2026-02-25) Completed `F015` by adding optional contact override selectors to:
  - `packages/clients/src/components/contacts/ContactDetails.tsx`
  - `packages/clients/src/components/contacts/ContactDetailsEdit.tsx`
- (2026-02-25) Completed `F016` by adding explicit precedence helper text in both client and contact destination controls:
  - Contact override -> Client destination -> Provider default
- (2026-02-25) Completed `F017` by emitting structured resolution logs:
  - destination source (`contact_override`, `client_default_from_contact`, `client_default_from_domain`, `provider_default`)
  - fallback warnings with configured invalid destination IDs and fallback reason
- (2026-02-25) Completed `F018` by adding in-app integration cases in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts` for:
  - exact contact override destination routing
  - exact contact using client destination
  - domain-matched client destination
  - unmatched sender using provider destination
- (2026-02-25) Completed `F019` by adding workflow-runtime integration coverage in:
  - `server/src/test/integration/resolveInboundTicketContext.destinationRouting.integration.test.ts`
  - includes direct parity assertion against `processInboundEmailInApp` for identical sender/provider input
- (2026-02-25) Completed `F020` by extending regression coverage:
  - explicit board-unchanged assertions on reply-token and thread-header reply flows
  - existing idempotency tests for duplicate reply/new-email processing remain in place and continue to validate dedupe behavior
- (2026-02-25) Completed `T001` by adding migration integration coverage in `server/src/test/integration/inboundTicketDestinationMigrations.integration.test.ts` to assert `clients.inbound_ticket_defaults_id` exists, is nullable, and is UUID-typed.
- (2026-02-25) Completed `T002` by extending the same migration integration suite to assert `contacts.inbound_ticket_defaults_id` exists, is nullable, and is UUID-typed.
- (2026-02-25) Completed `T003` by adding index coverage in the same migration integration suite, asserting:
  - `idx_clients_tenant_inbound_ticket_defaults` on `clients(tenant, inbound_ticket_defaults_id)`
  - `idx_contacts_tenant_inbound_ticket_defaults` on `contacts(tenant, inbound_ticket_defaults_id)`
- (2026-02-25) Completed `T004` by adding rollback-path coverage in the same migration integration suite:
  - executes migration `down` functions inside a transaction and asserts both columns/indexes are removed
  - executes migration `up` functions inside the same transaction and asserts both columns/indexes are restored
  - rolls back transaction to avoid mutating shared integration DB state
- (2026-02-25) Completed `T005` by adding shared resolver unit coverage in `shared/workflow/actions/__tests__/emailWorkflowActions.destinationResolver.test.ts` for precedence path:
  - exact sender contact + contact override resolves `source=contact_override`
  - returns contact override defaults and does not consult client defaults
- (2026-02-25) Completed `T006` by extending shared resolver unit coverage for precedence path:
  - exact sender contact with no override resolves `source=client_default_from_contact`
  - uses the matched contact's client `inbound_ticket_defaults_id`
- (2026-02-25) Completed `T007` by extending shared resolver unit coverage for domain path:
  - when no exact contact is provided and domain client is matched, resolves `source=client_default_from_domain`
  - returns domain client's active defaults
- (2026-02-25) Completed `T008` by extending shared resolver unit coverage for fallback path:
  - when neither exact-contact nor domain destination applies, resolves `source=provider_default`
  - returns provider defaults unchanged with no fallback reason
- (2026-02-25) Completed `T009` by extending shared resolver unit coverage for invalid override safety:
  - invalid/inactive contact override destination falls back to `source=provider_default`
  - emits `fallbackReason=invalid_or_inactive_contact_override`
- (2026-02-25) Completed `T010` by extending shared resolver unit coverage for invalid client destination safety:
  - invalid/inactive client destination (from exact-contact client path) falls back to `source=provider_default`
  - emits `fallbackReason=invalid_or_inactive_client_default_from_contact`
- (2026-02-25) Completed `T011` by confirming in-app integration coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Routing destination: exact sender contact override uses contact override defaults board` asserts board/client/contact routing from contact override defaults.
- (2026-02-25) Completed `T012` by confirming in-app integration coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Routing destination: exact sender without contact override uses contact's client destination defaults` asserts exact-contact fallback to client destination defaults.
- (2026-02-25) Completed `T013` by confirming in-app integration coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Routing destination: unknown sender + domain-matched client uses domain client destination defaults` asserts domain-matched unknown-contact routing.
- (2026-02-25) Completed `T014` by confirming in-app integration coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Unmatched sender: system follows the defined behavior without throwing` asserts provider-default board/client fallback for unmatched routing.
- (2026-02-25) Completed `T015` by confirming workflow integration coverage exists in `server/src/test/integration/resolveInboundTicketContext.destinationRouting.integration.test.ts`:
  - test case `returns contact override destination outcome for exact sender` asserts `resolve_inbound_ticket_context` returns contact-override destination.
- (2026-02-25) Completed `T016` by confirming workflow integration coverage exists in `server/src/test/integration/resolveInboundTicketContext.destinationRouting.integration.test.ts`:
  - test case `returns client's destination outcome when exact sender has no contact override` asserts workflow action returns client-default destination.
- (2026-02-25) Completed `T017` by confirming workflow integration coverage exists in `server/src/test/integration/resolveInboundTicketContext.destinationRouting.integration.test.ts`:
  - test case `returns domain-matched client destination outcome when sender is unknown contact` asserts domain-matched destination resolution.
- (2026-02-25) Completed `T018` by confirming workflow/in-app parity coverage exists in `server/src/test/integration/resolveInboundTicketContext.destinationRouting.integration.test.ts`:
  - test case `matches in-app destination selection for the same sender/provider input` compares runtime action output with `processInboundEmailInApp` ticket results.
- (2026-02-25) Completed `T019` by confirming reply-token regression coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Reply threading: reply token resolves ticket and creates exactly 1 new comment` now asserts ticket board remains unchanged after reply threading.
- (2026-02-25) Completed `T020` by confirming thread-header regression coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Reply threading: thread headers resolve ticket and create exactly 1 new comment` now asserts ticket board remains unchanged after thread-header matching.
- (2026-02-25) Completed `T021` by confirming exact-contact matching regression coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Contact match: sender email is normalized from display-name format` asserts contact/client IDs still resolve from exact sender match semantics.
- (2026-02-25) Completed `T022` by confirming explicit-domain matching regression coverage exists in `server/src/test/integration/inboundEmailInApp.webhooks.integration.test.ts`:
  - test case `Domain fallback: does not match by domain unless the domain is explicitly configured` asserts no inferred domain ownership from contact records.
- (2026-02-25) Completed `T023` by adding `packages/clients/src/actions/inboundTicketDestinationActions.test.ts` coverage for client destination actions:
  - rejects updates without `client:update` permission
  - rejects cross-tenant destination IDs via tenant-scoped `inbound_ticket_defaults` validation
- (2026-02-25) Completed `T024` by extending `packages/clients/src/actions/inboundTicketDestinationActions.test.ts` coverage for contact destination actions:
  - rejects updates without `contact:update` permission
  - rejects cross-tenant destination IDs via tenant-scoped `inbound_ticket_defaults` validation
- (2026-02-25) Completed `T025` by adding `packages/clients/src/components/clients/ClientDetails.inboundDestination.wiring.test.ts`:
  - verifies client UI destination select wiring (`value`, `allowClear`, `onValueChange`)
  - verifies persistence path calls `updateClient(...)` and that server-side client update normalizes cleared empty strings to `null`
- (2026-02-25) Completed `T026` by:
  - extending `packages/clients/src/actions/contact-actions/contactActions.tsx` to persist `inbound_ticket_defaults_id` updates, normalize clears to `null`, and tenant-validate destination IDs
  - adding `packages/clients/src/components/contacts/ContactDetails.inboundDestination.wiring.test.ts` to verify contact UI set/clear wiring and save-path persistence through `updateContact(...)`
