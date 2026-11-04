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

## Implementation interpretation

The design's stricter administration policy takes precedence over the finding's suggested minimum: administrative reads require both `ticket_settings:read` and `ticket_settings:update`; writes require `ticket_settings:update`. Manual template application also requires an MSP principal and `ticket_settings:update`, in addition to per-ticket update authorization. Creation must explicitly supply `client_id`; `null` deliberately selects tenant-wide scope.

Operational picker reads are separate from administration. Existing-ticket reads authorize the ticket and filter by its client. Editors without a ticket use MSP `ticket_template:read` or `recurring_ticket:read`, matching the editor being loaded, and return only active option IDs/names in the selected tenant/client scope. A null client exposes only tenant-wide choices. These options do not grant template/rule mutation or manual application privileges.
