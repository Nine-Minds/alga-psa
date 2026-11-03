# Design — Security: authz in requireSettingsPermission

Card: Security: authz in requireSettingsPermission

## Finding (confirmed on main)

packages/tickets/src/actions/checklists/checklistTemplateActions.ts:82-85 gates the whole checklist-template surface on `ticket:update`, which client users hold by default (server/migrations/utils/permissions/catalog.cjs:324-325), instead of the MSP-admin `ticket_settings:update` (catalog.cjs:327-330); a technician can therefore create a template with an always-true apply rule that rewrites future tickets tenant-wide.

## Approach

1. Gate every checklist-template read/write on `ticket_settings:update` (the dedicated configuration permission), not `ticket:update`; require an explicit client_id for tenant-wide templates.
2. Reject an empty-clause `{join:'and',clauses:[]}` predicate (always-true) in `createChecklistTemplateApplyRule`, and validate rule scope against the caller.
3. Tests: a technician and a client user are refused template create/apply; an MSP admin succeeds; an always-true rule is rejected.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
