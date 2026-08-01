# Revise Quotes — Implementation Plan (2026-07-31)

## Problem

Customer report (internal ticket alga0002206): once a quote is sent there is no
visible way to revise it; the workaround is duplicate + cancel.

Root cause and gaps found during the design session:

1. **Hidden primary action in QuoteForm.** For a `sent` quote, `resolvePrimaryAction()`
   returns "Revise", but primary buttons only render when `!isReadOnly`
   (`QuoteForm.tsx:1279`), and every non-draft quote is read-only (`QuoteForm.tsx:941`).
   The sent-status overflow menu (`resolveOverflowItems`) contains only Resend /
   Send reminder / Cancel quote, so Revise is computed then unreachable. The
   accepted-status branch already rescues hidden primaries into the overflow (see the
   comment at `QuoteForm.tsx:1082`); the sent branch never got the same treatment. The
   form even shows "This quote is read-only. To make changes, create a new revision"
   with no way to do it.
2. **Backend status gate is too narrow and inconsistent with the UI.**
   `Quote.createRevision` (`packages/billing/src/models/quote.ts:360`) only accepts
   `sent` and `rejected`, while QuoteForm offers "Create new revision" on `expired`
   quotes — which errors server-side today.
3. **No Revise in the quotes list.** The row "..." menu in `QuotesTab.tsx` offers
   Duplicate (the workaround) but not Revise.

## Decisions (settled with Robert)

- Revisable statuses: **`sent`, `rejected`, `expired`, `cancelled`, `accepted`**.
- For `accepted` quotes, Revise lives in the **overflow menu** — conversion remains the
  headline action. For the other revisable statuses Revise is the primary action.
- Revise stays reachable from all three surfaces: quote form, quote detail view, and
  the quotes list row menu.

## Changes

### 1. Backend — widen the revisable-status gate

`packages/billing/src/models/quote.ts` (`createRevision`):

- Replace `['sent', 'rejected']` with a shared constant, e.g.
  `REVISABLE_QUOTE_STATUSES = ['sent', 'rejected', 'expired', 'cancelled', 'accepted']`.
  Export it from `packages/types` (next to `QuoteStatus` in
  `packages/types/src/interfaces/quote.interfaces.ts`) so UI and model share one
  definition instead of hand-maintained parallel lists.
- Behavior is unchanged otherwise: revision copies the quote + items into a new
  `draft` with bumped `version`, marks the source `superseded`, and logs both
  activities. Timestamps recording the source quote's history (`accepted_at`,
  `cancelled_at`, …) stay on the superseded row untouched.
- Update the error message to name the allowed statuses.

No migration needed — no schema change.

### 2. QuoteForm — make workflow actions independent of form read-only state

`packages/billing/src/components/billing-dashboard/quotes/QuoteForm.tsx`:

- `isReadOnly` should keep gating **field editing only**. Workflow actions (the
  primary/secondary buttons and overflow menu) must render based on status, not on
  read-only. Concretely: render the primary action row whenever a primary action
  exists, dropping the `!isReadOnly` condition, and delete the
  `isPrimaryActionVisible` rescue machinery in `resolveOverflowItems` once it is no
  longer needed (the accepted-status conversions become ordinary visible primaries /
  overflow items). This also fixes the same latent trap for `pending_approval`.
- Status coverage in `resolvePrimaryAction` / `resolveOverflowItems`:
  - `sent`: primary **Revise** (already coded); overflow Resend / Send reminder /
    Cancel quote (unchanged).
  - `rejected`, `expired`: primary **Revise** (already coded for these labels).
  - `cancelled`: add primary **Revise** (new — currently no actions).
  - `accepted`: conversions primary as today; add **Revise** to the overflow items.
- The read-only notice text stays, since it now sits next to a working Revise button.

### 3. QuoteDetail — cover the new statuses

`packages/billing/src/components/billing-dashboard/quotes/QuoteDetail.tsx`
(`renderPrimaryActions`):

- `sent` and `rejected` already render Revise — unchanged.
- Add Revise for `expired` and `cancelled` (currently these statuses render nothing
  or lack it).
- `accepted`: add Revise as a secondary (outline) button after the conversion
  buttons, mirroring the overflow placement in the form.

### 4. QuotesTab — Revise in the list row menu

`packages/billing/src/components/billing-dashboard/quotes/QuotesTab.tsx`:

- Add a **Revise** item to the row "..." menu, next to Duplicate, shown when the row
  status is in `REVISABLE_QUOTE_STATUSES`.
- On click: call `createQuoteRevision(quote_id)`, then navigate to the new draft
  (same navigation the form/detail `handleReviseQuote` handlers use) and refresh the
  list. Surface errors via the existing toast pattern in the tab.
- Note the sub-tab status filters (`SUBTAB_STATUSES`): after revising, the source
  quote becomes `superseded` and the new draft appears under the draft sub-tab; reuse
  the existing post-action refresh so rows move buckets correctly.

### 5. i18n

New default-value strings only (`Revise` already exists as
`common.actions.revise` / `quoteForm.actions.revise`). Add any new keys with
`defaultValue` per existing convention; update locale files if the repo keeps
translated catalogs for these namespaces.

## Testing

- **Model tests** (`packages/billing/tests/quote/`): `createRevision` succeeds from
  each of the five revisable statuses (asserting version bump, item copy, source →
  `superseded`, activity rows) and still rejects `draft`, `pending_approval`,
  `approved`, `converted`, `superseded`, `archived`, and templates.
- **Component/behavior checks**: sent quote in QuoteForm shows a visible Revise
  primary; accepted quote shows conversions plus Revise in overflow; cancelled quote
  shows Revise; list row menu shows Revise for revisable statuses only.
- **Manual smoke**: open a sent quote from the list → Revise → land on editable
  draft vN+1 → send it; verify the old version shows Superseded and appears under
  the detail view's Revisions section.

## Out of scope

- Any change to conversion flows, quote numbering, or the revision data model.
- Client-portal surfaces (revision is an MSP-side action).
