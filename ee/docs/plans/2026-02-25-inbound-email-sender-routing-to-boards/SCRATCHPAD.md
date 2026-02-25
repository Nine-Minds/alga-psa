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

## Discoveries / Constraints

- (2026-02-25) Existing sender-domain-to-client mapping already exists and is explicit via `client_inbound_email_domains`.
- (2026-02-25) `processInboundEmailInApp` currently sets ticket board from provider defaults (`defaults.board_id`) and does not vary by sender.
- (2026-02-25) `resolve_inbound_ticket_context` currently resolves target client/contact/location only; it does not yet compute sender-based destination defaults.
- (2026-02-25) `ClientDetails` already includes inbound-domain and default-contact controls, making client-level destination a natural extension.

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

## Links / References

- In-app inbound pipeline:
  - `shared/services/email/processInboundEmailInApp.ts`
- Workflow action registration and context resolution:
  - `shared/workflow/runtime/actions/registerEmailWorkflowActions.ts`
- Shared email workflow actions:
  - `shared/workflow/actions/emailWorkflowActions.ts`
- Existing client inbound domain actions:
  - `packages/clients/src/actions/clientInboundEmailDomainActions.ts`
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
