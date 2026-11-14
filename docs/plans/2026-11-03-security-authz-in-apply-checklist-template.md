# Design — authorize checklist template application per ticket

Card: `c3c84ec3-0de7-5b9d-871a-d963c764709f` · PSA ticket: `alga-2026-0003085`
Finding: `packages/tickets/src/actions/checklists/applyChecklistTemplate.ts#applyChecklistTemplate`

## Finding

`applyChecklistTemplate` currently checks the coarse `ticket:update` permission and
then only confirms that the supplied ticket exists in the tenant. It passes that
caller-supplied ID to `applyChecklistTemplateToTicket`, which can insert checklist
items and write ticket activity. A client user who has the coarse permission can
therefore mutate a ticket outside their record-level visibility.

## Change

Keep the coarse permission check. Inside the existing transaction, call the
existing `authorizeTicketRecordAccessConcealed` with action `update` before the
template is loaded or checklist rows are touched. Use its returned ticket row
for template/client scope validation and pass the row's client ID to the shared
application helper so it need not perform a second ticket lookup. Client users
continue to receive the concealed permission error for both missing and
inaccessible tickets. Keep `TEMPLATE_CLIENT_MISMATCH` as a distinct outcome.

## Regression coverage

Exercise the action with a client user who passes coarse `ticket:update` but is
denied record access. The supplied ticket and template are valid; assert that
the action returns the permission error and checklist rows and ticket activity
remain unchanged. Also cover authorized application and preserve the separate
template/client mismatch result.

## Validation

Run the focused behavioral action tests and the applicable package typecheck or
build. `security-finding-resolved` should map this finding to the inaccessible
ticket regression and verify authorized application and client mismatch remain
valid.
