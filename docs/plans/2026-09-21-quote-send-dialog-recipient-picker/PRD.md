# PRD — Shared quote send dialog with recipient picker

- Slug: `2026-09-21-quote-send-dialog-recipient-picker`
- Date: `2026-09-21`
- Ticket: `alga-2026-0002521`
- Status: Draft

## Summary

Sending a quote from the quote list and sending it from the quote detail currently
present different recipient controls. The detail dialog includes
`QuoteSendRecipientsField`, which loads internal users and active contacts for the
quote's client, while the list dialog accepts only a comma-separated free-text
field. The list therefore gives an operator no discoverable way to choose known
recipients.

Extract the detail dialog's recipient-selection experience into one shared quote
send dialog and use it from both `QuoteDetail.tsx` and `QuotesTab.tsx`. The list
path will retain the selected quote's `client_id` while opening the dialog. The
shared dialog will combine picker selections and additional typed addresses into
the `email_addresses` value supplied to `sendQuote`, using the same normalization
and case-insensitive de-duplication behavior already present in the detail path.

## Problem

`QuoteDetail.tsx` renders `QuoteSendRecipientsField` with `quote.client_id` and
combines selected recipients with typed addresses before calling `sendQuote`.
`QuotesTab.tsx` has a separate dialog that stores only `quoteId`, renders only an
additional-address input, and sends only those typed addresses. Although each
list row is an `IQuoteListItem` and already contains `client_id`, that value is
dropped by the `onSend` callback.

This produces two user-visible problems:

1. An operator sending from the list cannot browse or select the internal users
   and active client contacts available from the quote detail.
2. The two entry points independently own dialog markup, labels, draft state, and
   payload construction, so behavior and copy can continue to drift.

On the server, `sendQuote` passes `email_addresses` to `getQuoteRecipients`, which
also includes the quote contact and the client's billing email when present. The
fix does not change that server behavior. It ensures recipients explicitly
chosen in the list dialog are included in the request instead of the list path
relying only on typed addresses and server-derived defaults.

## Goals

1. Give quote-list users the same recipient picker available in quote detail.
2. Use one dialog implementation for the quote-list and quote-detail send flows.
3. Carry the selected list record's `client_id` into the dialog so the picker can
   load the correct active client contacts.
4. Send the union of picked recipients and comma-separated additional addresses,
   with whitespace removed and duplicate email addresses collapsed without
   regard to case.
5. Preserve the existing quote-send action contract, authorization, lifecycle,
   status transition, notification behavior, parent-level notices, and data
   refresh behavior.

## Non-goals

- Changing `sendQuote`, `getQuoteRecipients`, or the server's inclusion of the
  quote contact and client billing email.
- Changing who is eligible for the picker; it continues to show internal users
  and active contacts returned by `QuoteSendRecipientsField`.
- Adding email-address syntax validation, contact creation, default preselection,
  CC/BCC roles, or a subject editor.
- Changing resend or reminder flows.
- Changing quote status eligibility, approval rules, permissions, PDF generation,
  email templates, or client-portal behavior.
- Migrating the separate send dialog inside `QuoteForm.tsx`. It already has the
  picker and merged-address behavior; this ticket is limited to parity between
  the quote list and the read-only quote detail.
- Database, migration, API-schema, or feature-flag work.

## Users and Primary Flows

### Billing operator sending from the quote list

1. The operator opens the three-dot menu for an eligible quote and selects
   **Send to Client**.
2. The list passes both the quote ID and that row's client ID into dialog state.
3. The shared dialog opens and the recipient picker loads internal users and the
   active contacts belonging to that client.
4. The operator selects one or more known recipients, optionally types additional
   comma-separated email addresses, and optionally adds a message.
5. On confirmation, the shared dialog supplies one normalized recipient array
   and the optional trimmed message to the list handler, which calls `sendQuote`.
6. The list retains its current post-send refresh and error presentation.

### Billing operator sending from quote detail

1. The operator selects **Send to Client** from an eligible quote detail.
2. The same shared dialog opens with `quote.client_id`.
3. Recipient selection, additional-address entry, message entry, and payload
   construction behave identically to the list flow.
4. The detail parent retains its current quote update, success notice, and error
   presentation.

### No explicit recipient selected

If the picker is empty and no additional address is typed, the dialog supplies no
`email_addresses` value. This preserves the current server-derived quote contact
and client billing-email behavior.

## UX / UI Notes

- The shared dialog contains, in order: the existing explanatory text, a labeled
  **Recipients** picker, a labeled comma-separated additional-email input, and a
  labeled optional-message text area.
- The picker continues to show recipient names, email addresses, avatars, and
  internal/contact type distinctions through `QuoteSendRecipientsField`.
- Title, field labels, placeholders, sending state, and button labels use the
  existing `msp/quotes` localization keys. The list and detail must not retain
  separate visible copy for equivalent controls.
- While sending, confirm and cancel actions remain disabled, matching the current
  dialogs.
- Closing the dialog clears picked recipients, additional addresses, and message
  so a later quote cannot inherit a previous quote's draft recipients.
- The component accepts an ID prefix (or equivalent explicit IDs) so list and
  detail keep stable, unique automation hooks without duplicating markup.
- Contact-loading and permission errors continue to render through
  `QuoteSendRecipientsField`; the dialog itself does not duplicate that logic.

## Design and Component Contract

Add a shared component next to the existing quote components, for example
`QuoteSendDialog.tsx`. It owns the dialog markup, the three draft fields, and the
recipient merge. Its public contract should contain the behavioral inputs the
parents actually differ on:

- `isOpen`: whether the dialog is visible.
- `clientId`: the client whose contacts the picker loads.
- `isSending`: disables actions and selects the sending label.
- `idPrefix`: provides stable IDs for the dialog and its controls.
- `onClose`: asks the parent to close the dialog.
- `onConfirm`: receives a `SendQuoteInput`-shaped value containing the merged
  `email_addresses` (when non-empty) and trimmed `message` (when non-empty).

The component must not fetch the quote, invoke `sendQuote`, update parent alerts,
or reload list/detail data. Those responsibilities remain with each parent. This
keeps the shared unit reusable while preserving the existing success and error
flows.

The merge algorithm is centralized in the shared component:

1. Read picker email addresses in selection order.
2. Split the additional-address field on commas, trim each entry, and remove
   empty entries.
3. Append typed addresses after picked addresses.
4. De-duplicate with a lowercase comparison key while preserving the first
   occurrence's spelling and ordering.
5. Omit `email_addresses` when the result is empty, and omit `message` when its
   trimmed value is empty.

Reset internal draft state when the dialog closes. A send failure that leaves the
dialog open must not clear the operator's selections. `clientId` changes must not
allow contacts or selected recipient state from one quote to leak into another.

## Requirements

### Functional Requirements

- FR1. `QuoteSendDialog` is the only send-dialog markup rendered by
  `QuoteDetail.tsx` and `QuotesTab.tsx`.
- FR2. The shared dialog renders `QuoteSendRecipientsField` with its current
  `clientId`, selected value, disabled state, and stable control ID.
- FR3. Opening Send from a quote-list row stores that row's `quote_id` and
  `client_id` together in `sendDialogState`.
- FR4. Every active, sent, and closed list-subtab call site that supplies
  `onSend` passes the full required row context rather than only the quote ID.
- FR5. The list handler sends the shared dialog's merged `email_addresses` and
  optional message to `sendQuote` for the quote ID captured with the client ID.
- FR6. The detail handler sends the same shared payload to `sendQuote` for the
  loaded quote.
- FR7. Duplicate addresses across picker and free text are emitted once using a
  case-insensitive comparison; the picked occurrence wins when duplicated.
- FR8. When no explicit address exists, `email_addresses` is `undefined`,
  preserving the server's existing derived-recipient behavior.
- FR9. Cancelling or successfully completing a send closes the dialog and clears
  all dialog draft state before the next open.
- FR10. The list continues to refresh quote data after a successful send; detail
  continues to replace its loaded quote and show its current success notice.
- FR11. Existing returned-action and thrown-error handling remains visible on
  the parent surface and the sending state always returns to idle.
- FR12. All user-facing strings remain localized in `msp/quotes`; no new raw
  English-only rendered strings are introduced.

### Non-functional Requirements

- NFR1. No database query, schema, action permission, or server-side recipient
  behavior changes are introduced.
- NFR2. The shared component uses existing UI primitives and
  `QuoteSendRecipientsField`; it does not duplicate recipient-loading logic.
- NFR3. The dialog retains stable IDs suitable for current and new component
  tests on both parent surfaces.
- NFR4. TypeScript makes `clientId` explicit in the list dialog state and shared
  component props so a future send entry point cannot silently omit the client
  context.

## Data / API / Integrations

No data model or API change is required. `IQuoteListItem` extends `IQuote`, so
`record.client_id` is already available in the list row. The existing
`SendQuoteInput` action shape already accepts `email_addresses?: string[]` and
`message?: string`.

`QuoteSendRecipientsField` remains responsible for loading internal users and
calling `getQuoteRecipientContacts(clientId, 'active')`. The shared dialog only
supplies the correct client ID and consumes the field's selected recipients.

## Security / Permissions

The fix does not broaden access. Recipient candidates continue to be returned by
authenticated actions using existing billing-read checks, and the send operation
continues to enforce billing-update permission plus quote status and approval
rules. The selected quote ID and client ID must come from the same list record;
the client ID is UI context for candidate loading and is not an authorization
substitute.

## Test Plan

1. **Shared dialog merge test:** select picker recipients, enter whitespace and
   comma-separated additional addresses including case-variant duplicates, enter
   a padded message, confirm, and assert one ordered/de-duplicated array plus a
   trimmed message reaches `onConfirm`.
2. **Shared dialog empty/reset test:** confirm with no recipients or message and
   assert both optional values are omitted; close and reopen for another client
   and assert prior recipients, addresses, and message are absent.
3. **Quote-list integration test:** invoke Send on a row and assert the shared
   dialog receives that row's `client_id`; choose a contact and add a typed
   address, confirm, and assert `sendQuote` receives both for the same row's
   `quote_id`.
4. **Quote-detail integration test:** open Send on a loaded quote and assert the
   shared dialog receives `quote.client_id`, then verify its merged payload is
   forwarded without the former local merge implementation.
5. **Failure and busy-state test:** verify controls disable while sending, the
   parent reports returned-action and thrown failures, and sending state returns
   to idle without leaking draft state to a different quote.
6. Run the focused billing quote component tests, quote i18n source checks, and
   the package TypeScript validation used by the billing workspace.

No DB-backed test is required because this plan changes only client component
composition and payload construction; existing server actions and database
behavior are unchanged.

## Rollout / Migration

No migration, backfill, feature flag, or tenant configuration is required. Ship
as a normal UI fix. Verification should cover at least one quote with multiple
active client contacts and one quote with no explicit picker selection.

## Risks and Mitigations

- **Mismatched row context.** If quote ID and client ID are looked up separately,
  filtering or refresh could pair the wrong records. Capture both from the same
  `IQuoteListItem` in the menu callback and keep them in one state object.
- **Stale recipients between quotes.** Internal dialog state could survive a
  close/open cycle. Reset all three draft fields on close and test reopening for
  a different client.
- **Duplicate delivery.** The same address may be picked and typed with different
  casing. Centralize case-insensitive de-duplication before invoking the action.
- **Copy or automation drift.** Existing list/detail dialogs use different keys
  and IDs. Select one localized copy set in the shared component while retaining
  deterministic prefixed IDs.
- **Server-recipient misunderstanding.** Explicit addresses do not replace the
  quote contact or client billing email under current `getQuoteRecipients`
  behavior. Keep that behavior documented and do not describe the picker as an
  exclusive recipient list.
- **Scope leaves a third implementation.** `QuoteForm.tsx` already behaves
  correctly but still owns equivalent markup. Keeping its migration out of this
  defect limits regression surface; a later cleanup can move it to the shared
  component with dedicated form tests.

## Open Questions

None blocking. The existing detail behavior defines the recipient candidates,
merge order, and omission semantics for this fix.

## Acceptance Criteria (Definition of Done)

- Sending from a quote-list three-dot menu displays the same recipient picker as
  the quote detail send flow.
- The list picker loads active contacts for the selected row's client and also
  offers eligible internal users.
- A recipient selected in the picker is included in the `email_addresses` sent
  for that quote.
- Picker selections and comma-separated additional addresses are combined,
  trimmed, empty entries removed, and duplicates collapsed case-insensitively.
- With no explicit picker or typed address, the existing server-derived recipient
  behavior remains intact.
- Quote list and quote detail render the same shared send-dialog component and no
  longer duplicate its field markup or merge logic.
- Cancel and successful-send paths clear dialog state; opening Send for another
  quote does not display the previous quote's recipients or message.
- Existing permissions, approval/status constraints, success notices, errors,
  list refresh, and quote-detail state update continue to work.
- Focused component, localization, and TypeScript checks pass.
