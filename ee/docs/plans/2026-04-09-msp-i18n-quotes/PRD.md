# PRD -- MSP i18n: Quotes Sub-batch

- Slug: `2026-04-09-msp-i18n-quotes`
- Date: `2026-04-09`
- Status: Draft

## Summary

Extract all hardcoded English strings from the 12 quoting components, create the `msp/quotes` namespace, wire `useTranslation()`, and generate translations for 7 languages plus 2 pseudo-locales.

## Problem

The entire quoting UI -- create/edit forms, detail views, quote lists, approval workflows, conversion dialogs, line-item editors, document template editors, and preview panels -- displays English-only text regardless of the user's locale preference. This is inconsistent with the rest of the MSP portal, which has been progressively translated.

## Goals

1. Create `server/public/locales/en/msp/quotes.json` with all extracted keys.
2. Wire all 12 component files with `useTranslation('msp/quotes')`.
3. Generate translations for 7 languages (de, es, fr, it, nl, pl, en) plus 2 pseudo-locales (xx, yy) -- 9 locale files total.
4. Register `msp/quotes` in `ROUTE_NAMESPACES` for `/msp/quote-approvals` and `/msp/quote-document-templates`.
5. Pass `validate-translations.cjs` with 0 errors across all 9 locales.
6. Zero regressions with the `msp-i18n-enabled` feature flag OFF.

## Non-goals

- Translating server-side quote actions or API responses.
- Translating the client-portal quote acceptance flow (that belongs to `client-portal` or `features/billing` namespaces).
- Refactoring component architecture.
- Translating `quoteLineItemDraft.ts` utility functions -- these are pure logic with no rendered strings (only `Intl.NumberFormat` calls that already respect locale).
- Translating the `QuoteStatusBadge.tsx` component -- it reads labels from `QUOTE_STATUS_METADATA` in `@alga-psa/types`, which is a shared type constant. Translating those labels requires a separate types-level effort.

## File Inventory

| # | File | LOC | Est. Strings | Category |
|---|------|-----|-------------|----------|
| 1 | `QuoteForm.tsx` | 1,072 | ~180-250 | Main create/edit form + workflow actions + send/approval/conversion dialogs |
| 2 | `QuoteDetail.tsx` | 1,106 | ~200-280 | Full detail view + all action dialogs + conversion preview + activity log |
| 3 | `QuotesTab.tsx` | 656 | ~80-120 | Quote list tab with sub-tabs, filters, row actions, send/delete dialogs |
| 4 | `QuoteDocumentTemplateEditor.tsx` | 596 | ~60-90 | Visual/code template editor with preview pipeline |
| 5 | `QuoteLineItemsEditor.tsx` | 585 | ~70-100 | Line items table, discount panel, phase sections, inline editing |
| 6 | `QuoteDocumentTemplatesPage.tsx` | 299 | ~30-45 | Template list page with actions menu |
| 7 | `QuoteConversionDialog.tsx` | 293 | ~40-55 | Standalone conversion dialog with mode selection and item preview |
| 8 | `QuoteApprovalDashboard.tsx` | 245 | ~35-50 | Approval queue with settings toggle |
| 9 | `QuoteTemplatesList.tsx` | 215 | ~25-35 | Business template list with actions |
| 10 | `QuotePreviewPanel.tsx` | 215 | ~15-25 | Preview panel with template selector |
| 11 | `QuoteStatusBadge.tsx` | 37 | 0 | Uses `QUOTE_STATUS_METADATA` -- no local strings |
| 12 | `quoteLineItemDraft.ts` | 247 | 0 | Pure logic utilities -- no rendered strings |
| | **Total** | **5,566** | **~535-1,050** | |

> String estimates use ~0.15-0.2 strings/LOC. Previous batches showed this overestimates by 1.5-2x. The lower bound (~535) is the more realistic target.

All files are in `packages/billing/src/components/billing-dashboard/quotes/`.

## Namespace Structure

```
msp/quotes.json
  quotesTab.*          -- QuotesTab.tsx list chrome, sub-tab labels, row actions, dialogs
  quoteForm.*          -- QuoteForm.tsx form labels, workflow buttons, dialogs
  quoteDetail.*        -- QuoteDetail.tsx detail sections, actions, dialogs, activity log
  quoteLineItems.*     -- QuoteLineItemsEditor.tsx table headers, discount panel, sections
  quoteConversion.*    -- QuoteConversionDialog.tsx mode labels, item mapping, summary
  quoteApproval.*      -- QuoteApprovalDashboard.tsx settings, filters, empty states
  quoteTemplates.*     -- QuoteTemplatesList.tsx list chrome, actions
  quotePreview.*       -- QuotePreviewPanel.tsx panel chrome, template selector
  templateEditor.*     -- QuoteDocumentTemplateEditor.tsx editor chrome, tabs, preview
  templatesPage.*      -- QuoteDocumentTemplatesPage.tsx page chrome, table columns, actions
  common.*             -- Shared labels reused across multiple quote components (e.g. Cancel, Back, Delete, Save)
```

## ROUTE_NAMESPACES Changes

The `/msp/billing` route already loads `features/billing` which will eventually include quote strings. However, two standalone quote routes need explicit namespace loading:

```typescript
'/msp/quote-approvals': ['common', 'msp/core', 'msp/quotes'],
'/msp/quote-document-templates': ['common', 'msp/core', 'msp/quotes'],
```

Additionally, the existing `/msp/billing` entry should add `msp/quotes`:

```typescript
'/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/reports', 'msp/quotes'],
```

## Acceptance Criteria

1. `server/public/locales/en/msp/quotes.json` exists and contains all extracted keys.
2. All 10 UI component files (excluding `QuoteStatusBadge.tsx` and `quoteLineItemDraft.ts`) import `useTranslation` from `@alga-psa/ui/lib/i18n/client` and use `t('key', { defaultValue: '...' })` for all user-visible strings.
3. Currency and date formatting uses `useFormatters()` where applicable, replacing hardcoded `new Intl.NumberFormat('en-US', ...)` calls.
4. All 9 locale files exist: `{de,en,es,fr,it,nl,pl,xx,yy}/msp/quotes.json`.
5. `validate-translations.cjs` passes with 0 errors and 0 warnings for `msp/quotes` across all 9 locales.
6. Italian translations use correct accents (verified by accent audit).
7. Pseudo-locale `xx` shows `11111` patterns for visual QA.
8. `ROUTE_NAMESPACES` in `packages/core/src/lib/i18n/config.ts` includes `/msp/quote-approvals` and `/msp/quote-document-templates` entries, and `/msp/billing` includes `msp/quotes`.
9. `npm run build` succeeds with no TypeScript errors.
10. No hardcoded English strings remain in the 10 wired component files (verified by grep for bare string literals in JSX).
