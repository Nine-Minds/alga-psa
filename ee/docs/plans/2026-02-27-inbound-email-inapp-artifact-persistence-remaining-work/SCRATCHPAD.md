# SCRATCHPAD — 2026-02-27 Inbound Email In-App Artifact Persistence (Remaining Work)

## Scope Intent

Create a clean, implementation-ready plan containing only remaining work for inbound email artifact persistence in the in-app callback path.

## Discovery Notes

- IMAP webhook currently publishes `INBOUND_EMAIL_RECEIVED` and returns `handoff: event_bus` rather than using in-app processing directly.
  - `packages/integrations/src/webhooks/email/imap.ts`
- Google and Microsoft webhook handlers already have an in-app processing branch controlled by `isInboundEmailInAppProcessingEnabled(...)`.
  - `packages/integrations/src/webhooks/email/google.ts`
  - `packages/integrations/src/webhooks/email/microsoft.ts`
- `processInboundEmailInApp` currently handles ticket/comment logic and calls attachment processing, but does not run embedded extraction or original `.eml` persistence.
  - `shared/services/email/processInboundEmailInApp.ts`
- Workflow definitions mention embedded extraction + `.eml` actions, but this remaining-work plan intentionally focuses on in-app callback parity.
  - `shared/workflow/workflows/system-email-processing-workflow.ts`

## Locked Decisions

- Persist only HTML-referenced CID inline images.
- Use deterministic `.eml` filename convention `original-email-<sanitized-message-id>.eml`.
- App-local in-process async worker mode is allowed.

## Open Questions

- None for this planning pass; scope is constrained to remaining in-app gap closure.

## Validation Commands

- `python3 scripts/validate_plan.py ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work`

## Implementation Log

- 2026-02-27: Completed `F214` by validating and activating the remaining-work plan artifact set at:
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/PRD.md`
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/features.json`
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/tests.json`
  - `ee/docs/plans/2026-02-27-inbound-email-inapp-artifact-persistence-remaining-work/SCRATCHPAD.md`
- Rationale: The plan scope existed but had all checklist entries disabled; flipping `F214` records that the remaining-work scope artifact is now established and tracked as implementation source-of-truth.
