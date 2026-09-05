# Plan — Fix sent quote Resend and Send Reminder actions

## Goal
In Quotes > Sent, the row action menu's **Resend** and **Send Reminder** currently call
`onSend(quote_id)`, which opens the Send to Client dialog whose confirmation calls
`sendQuote()` — and `sendQuote()` rejects anything that is not draft/approved
("Only draft or approved quotes can be sent"). Wire the two sent-status items to their
dedicated server actions `resendQuote()` and `sendQuoteReminder()`, which already exist
in `quoteActions.ts` and are already used correctly by Quote Detail and Quote Form.

## Changes

1. **`packages/billing/src/components/billing-dashboard/quotes/QuotesTab.tsx`**
   - Add `resendQuote` and `sendQuoteReminder` to the existing import from
     `../../../actions/quoteActions` (line 28).
   - Add two handlers mirroring the existing `handleDuplicateQuote` pattern
     (~line 439): clear error, call the action, on
     `isReturnedActionError(result)` -> `setError(getErrorMessage(result))` and
     return; on success `void loadData()`; catch -> `setError(...)` with a
     `t()` fallback (new keys `quotesTab.errors.resend` /
     `quotesTab.errors.sendReminder`, defaultValues so no i18n edit needed).
   - Re-wire the two `status === 'sent'` menu items (currently ~lines 171 and
     181): **Resend** -> `handleResendQuote(record.quote_id)`, **Send Reminder**
     -> `handleSendReminder(record.quote_id)`. Keep the `status === 'sent'`
     visibility guards exactly as they are.
   - Leave `onSend` / the Send dialog untouched — it remains correct for
     draft/approved "Send to Client".

## Tests

2. **New behavioral test** — `packages/billing/src/components/billing-dashboard/quotes/QuotesTab.test.tsx`,
   following the `InvoicePreviewPanel.test.tsx` vitest + testing-library pattern:
   - `vi.mock` `@alga-psa/billing/actions/quoteActions` (sendQuote, resendQuote,
     sendQuoteReminder, listQuotes, etc.), `next/navigation`, and the shared
     DataTable/CustomTabs surface as needed.
   - Seed a `sent` quote in the Sent sub-tab. Assert:
     - clicking the Resend menu item calls `resendQuote(quote_id)` and NOT
       `sendQuote`.
     - clicking the Send Reminder menu item calls `sendQuoteReminder(quote_id)`
       and NOT `sendQuote`.

## Deliberately NOT doing
- No changes to `quoteActions.ts` — `resendQuote`/`sendQuoteReminder` already
  exist, are auth/permission-guarded, and are correct.
- No changes to Quote Detail / Quote Form (already correct).
- No i18n file edits (defaultValue fallbacks render fine).
- No server-side or schema changes.

## Risks
- `QuotesTab` pulls several server actions (`listQuotes`, templates) and the
  DataTable surface; the test must mock those to render. Keep the test narrow:
  menu-open + click + assert the dedicated action fired and `sendQuote` did not.
- `'use client'` + server-action import boundary: Quote Detail already calls
  these actions from a client component, so this is proven safe.
- Row action menu is a Radix `DropdownMenu` inside a `DataTable` render column —
  click-through in tests may need `userEvent` on the `resend-quote-<id>-menu-item`
  / `remind-quote-<id>-menu-item` test ids that already exist.
