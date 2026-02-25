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
