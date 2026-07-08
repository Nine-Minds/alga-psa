# Inventory i18n pass — residual UI strings

**Date:** 2026-07-08
**Branch:** `feature/inventory-i18n-pass`
**Status:** Approved design; ready for implementation.

## Context

An i18n audit of the inventory feature found the interactive React UI almost fully
translated (all 25 components use `useTranslation('features/inventory')`), with the
remaining leaks concentrated in two buckets this branch closes:

1. **Server-side user-facing error strings (P1)** — 8 hardcoded English messages in
   `salesOrderDocumentActions.ts` and the two sales-order document API routes. These
   surface verbatim as UI toasts via the established
   `toast.error(e?.message || t(fallback))` pattern.
2. **Residual component strings (P3)** — 5 stragglers inside React components.

**Explicitly out of scope** (deferred to future branches, per design session):

- Document-template / AST i18n (`sales-order-template-ast/`, `quote-template-ast/`,
  `invoice-template-ast/` — the customer-facing PDF layer). This is an engine change
  (translator threading or an i18n AST node) deliberately left for another day.
- The 16 hardcoded `metadata.title` strings in `server/src/app/msp/inventory/*/page.tsx`.

## Conventions this plan sets

This is the **first use of translation in server actions/routes** in the codebase.
The precedent, agreed in the design session:

- Server code translates **server-side** using
  `getServerTranslation` from `@alga-psa/ui/lib/i18n/serverOnly`
  (existing server-component precedent: `server/src/app/msp/tickets/page.tsx`), which
  resolves the requesting user's locale (session/cookies/tenant settings). Usage:
  `const { t } = await getServerTranslation(undefined, 'features/inventory');`
- Messages cross to the client already translated; client toast code
  (`e?.message || t(fallback)`) is untouched.
- Keys live in `features/inventory.json` alongside the rest of the feature.

## Task 1 — Typed error for sales-order document actions

**Problem:** both API routes classify HTTP status by regexing the *English* message:

- `server/src/app/api/inventory/sales-orders/[id]/document/route.ts:35`
- `server/src/app/api/inventory/sales-orders/[id]/email-confirmation/route.ts:35`

```ts
const status = /permission denied/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
```

Translated messages break this, so the status signal must become machine-readable
before translation lands.

**Change:** add a small error class in `packages/billing` (suggested:
`packages/billing/src/lib/salesOrderDocumentError.ts`):

```ts
export type SalesOrderDocumentErrorCode = 'permission_denied' | 'not_found' | 'generation_failed';

export class SalesOrderDocumentError extends Error {
  constructor(message: string, public readonly code: SalesOrderDocumentErrorCode) {
    super(message);
    this.name = 'SalesOrderDocumentError';
  }
}
```

- `salesOrderDocumentActions.ts` throws `SalesOrderDocumentError` with the
  appropriate code (and, after Task 2, a translated message).
- Both routes replace the regex with: `instanceof SalesOrderDocumentError` →
  map `code` to 403 / 404 / 400; anything else keeps the current 400 fallback.
- The action is consumed in-process by these route handlers, so thrown errors
  survive; the `permissionError()` return-object convention in
  `@alga-psa/ui/lib/errorHandling` exists for the server-action client transport
  and is not needed here. Confirm no other caller of these actions relies on
  English-text sniffing (e.g. `isPermissionError`) — the two routes above are the
  only known consumers.

## Task 2 — Translate the server-side error strings

**File: `packages/billing/src/actions/salesOrderDocumentActions.ts`**

Call `getServerTranslation(undefined, 'features/inventory')` at the top of each
exported action (it is async and cached per request). Replace:

| Line | Current literal | Key |
|---|---|---|
| 31 | `Permission denied: cannot download sales order documents` | `salesOrders.errors.downloadPermissionDenied` |
| 37 | `Sales order not found` | `salesOrders.errors.notFound` |
| 86 | `Permission denied: cannot email sales order documents` | `salesOrders.errors.emailPermissionDenied` |
| 92 | `Sales order not found` | `salesOrders.errors.notFound` (shared) |
| 102 | `No recipient email on file for this client.` | `salesOrders.errors.noRecipientEmail` |
| 138 | `Email failed to send.` | `salesOrders.errors.emailSendFailed` |

Thrown ones become `SalesOrderDocumentError` per Task 1 (lines 31/86 →
`permission_denied`, 37/92 → `not_found`); lines 102/138 stay as returned
`{ success: false, error: t(...) }` values.

**Files: the two API routes** — translate the catch-block fallbacks the same way:

- `document/route.ts:34` `'Failed to generate the document'` → `salesOrders.errors.documentGenerationFailed`
- `email-confirmation/route.ts:32` `'Failed to email the confirmation'` → `salesOrders.errors.emailConfirmationFailed`

Verify `getServerTranslation` resolves locale correctly in route-handler context
(`cookies()`/`headers()` are available there); if the untranslated-key string ever
leaks, the `t(key, 'English default')` form guarantees a sane fallback.

## Task 3 — Residual component strings

1. **`packages/inventory/src/components/SalesOrdersManager.tsx:52-56`** — the
   `label:` values in `SO_DOCUMENT_TYPES` are dead: rendering goes through the
   `t()`-backed map at line ~205. **Remove the `label` field** from the constant
   (and its type usage) — dead-code removal, not translation. Confirm nothing else
   reads `.label` before deleting.
2. **`packages/inventory/src/components/TransfersManager.tsx:210`** — the persisted
   `notes: 'Van load list replenishment'` becomes
   `t('transfers.vanLoadListReplenishment', 'Van load list replenishment')`.
   Design decision (approved): the note freezes in the *creating* user's locale —
   acceptable for free-text note data.
3. **`packages/inventory/src/components/dashboard/shared.tsx` (AgePill, ~line 191)** —
   replace the hardcoded `` `${days}d` `` suffix with the **existing** key
   `dashboard.attention.metric.ageDays` = `"{{days}}d"`:
   `t('dashboard.attention.metric.ageDays', '{{days}}d', { days })`, keeping the
   `prefix` prepended as today. Add the file's missing
   `useTranslation('features/inventory')` import (from `@alga-psa/ui/lib/i18n/client`).
   If `AgePill` is consumed anywhere a hook can't run, fall back to threading `t`
   in as a prop — check call sites first.

## Task 4 — Locale files

New keys (7): `salesOrders.errors.{downloadPermissionDenied, notFound,
emailPermissionDenied, noRecipientEmail, emailSendFailed,
documentGenerationFailed, emailConfirmationFailed}` and
`transfers.vanLoadListReplenishment`. (AgePill reuses an existing key.)

- Add to `server/public/locales/en/features/inventory.json` in alphabetical
  position within their sections.
- Provide translations for the 7 real locales: `de`, `es`, `fr`, `it`, `nl`, `pl`, `pt`.
- Regenerate pseudo-locales `xx`/`yy` via `server/scripts/generate-pseudo-locales.cjs`
  (scope to the touched namespace if the script supports it).
- Run `server/scripts/validate-translations.cjs` and
  `server/scripts/find-missing-i18n-keys.cjs`; both must pass clean for
  `features/inventory`.

## Verification

1. Typecheck + existing test suites for `packages/billing` and `packages/inventory`
   (including `salesOrderDocumentActions` tests if present — update fixtures that
   assert on the old literal messages or `Error` type).
2. On the running dev stack (`http://localhost:3777`):
   - Trigger a sales-order document download failure (nonexistent SO id via the
     API route) → JSON error body carries the translated message and the correct
     status (404 not 400).
   - Create a van-load-list transfer → the persisted note reads from the new key.
   - Inventory dashboard → AgePill renders `Nd` via the key (spot-check with the
     `xx` pseudo-locale to confirm resolution).
3. Grep gate: no remaining hardcoded user-facing English literals in
   `salesOrderDocumentActions.ts`, the two routes, or the three touched components.
