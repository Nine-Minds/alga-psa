# Inventory Document Layouts — Discoverability

**Branch:** `feature/inventory-document-templates`
**Date:** 2026-07-07
**Type:** Discoverability / navigation wiring (no backend, no schema, no rendering changes)

## Background

The inventory "document layout" designers for **Sales Order**, **Packing Slip**, and
**Pick List** are already built end-to-end and live:

- **Designer UI** — `DocumentTemplatesPage` / `DocumentTemplateEditor`
  (`packages/billing/src/components/billing-dashboard/documents/`) provide a full list +
  visual designer + live server-side preview + save / clone / set-default / delete, at
  parity with Quote and Invoice Layouts.
- **Route** — `server/src/app/msp/document-templates/[type]/page.tsx` validates `type`
  against the document-type registry (`packages/billing/src/lib/document-templates/registry.ts`)
  and renders `DocumentTemplatesPage`.
- **Persistence** — per-tenant tables (`document_templates`, `document_template_assignments`),
  transactional RBAC-guarded server actions (`packages/billing/src/actions/documentTemplateActions.ts`,
  `.../lib/document-templates/storage.ts`).
- **Consumption** — the Sales Orders screen (`packages/inventory/src/components/SalesOrdersManager.tsx`)
  already downloads/emails PDFs via `/api/inventory/sales-orders/[id]/document?type=…`, which
  renders the tenant/client-default template the designer saves
  (`packages/billing/src/services/pdfGenerationService.ts`).

The feature was built in phases (P1 → Phase 2 spine → Phase 3 packing-slip/pick-list). The
**only** unfinished step is navigation: nothing in `menuConfig.ts` points to
`/msp/document-templates/[type]`, so users can only reach the designers by typing the URL.
There is also a UX disconnect — users *produce* these PDFs from the Sales Orders screen but
have no discoverable path to the designer that *customizes* them.

## Goal

Make the three layout designers reachable by end-users. Pure discoverability. No changes to
persistence, template resolution, or PDF generation.

## Scope

### In scope
1. An Inventory sidebar entry that opens the Document Layouts designer.
2. An in-page type switcher so a user can flip between Sales Order / Packing Slip / Pick List.
3. A contextual "Manage layouts" link on the Sales Orders screen.

### Out of scope (explicitly unchanged)
- Per-sales-order (entity-level) template override — only tenant/client defaults resolve today.
- The "Default" column not reflecting a *standard* template set as default
  (`storage.ts:43-50`) — cosmetic.
- Any new persistence, migrations, API routes, or PDF-rendering work.

## Implementation

### Change 1 — Inventory menu entry

**File:** `server/src/config/menuConfig.ts`

Add one item to the **Inventory** `subItems` array, immediately after the `Sales Orders`
entry (currently ~line 158):

```ts
{ name: 'Document Layouts', translationKey: 'nav.inventoryDocumentLayouts',
  icon: LayoutTemplate, href: '/msp/document-templates/sales-order' },
```

- `LayoutTemplate` is already imported in this file (used by Quote Layouts / Contract
  Templates) — reuse it for visual consistency.
- The href lands on the `sales-order` type: it is the primary document, and packing-slip /
  pick-list are derived from the same Sales Order data.
- The entry is picked up by the menu-driven nav search automatically.

**File:** `server/public/locales/en/msp/core.json`

Add the translation key alongside the other `inventory*` nav keys:

```json
"inventoryDocumentLayouts": "Document Layouts",
```

Other-locale parity (the many `locales/<lang>/msp/core.json` files) is a mechanical
follow-up; the `name` field in `menuConfig.ts` is the English fallback, so the menu renders
correctly meanwhile.

### Change 2 — In-page type switcher

**File:** `packages/billing/src/components/billing-dashboard/documents/DocumentTemplatesPage.tsx`

Add a segmented/tab control to the existing list-view header row (the flex container holding
the `{typeLabel} Layouts` heading and the `New Layout` button, ~line 277). Behavior:

- Options come from `DOCUMENT_TYPES` (registry) mapped to their `label`s via
  `getDocumentTypeRegistryEntry` — data-driven, so a future registered type appears
  automatically.
- The active option = the current `documentType` prop.
- Selecting an option calls `router.push('/msp/document-templates/' + type)` using
  `next/navigation` (`DocumentTemplatesPage` is already a `'use client'` component).
- It lives only in the list-view return block. Editor mode returns early (~line 265), so the
  switcher never appears mid-edit and switching cannot interrupt an unsaved edit.

Use the existing UI segmented-control / tabs primitive from `@alga-psa/ui` for consistency
with the rest of the app (match whatever Quote/Invoice Layouts-adjacent screens use).

### Change 3 — Contextual link from Sales Orders

**File:** `packages/inventory/src/components/SalesOrdersManager.tsx`

Near the existing document-download controls (the block around lines 47–91 defining the
document types and `downloadSalesOrderDocument`), add a small "Manage layouts" link/button
that navigates to `/msp/document-templates/sales-order`. Placement should sit with the
document controls so the relationship (download here → customize there) is legible. Use the
app's standard link/button primitive; no new download logic.

## Verification

Manual smoke on the running dev stack (port 3367):

1. **Menu** — Inventory sidebar shows "Document Layouts" after "Sales Orders"; clicking it
   loads `/msp/document-templates/sales-order` and renders the Sales Order Layouts list.
2. **Switcher** — the type switcher shows all three types with Sales Order active; selecting
   Packing Slip / Pick List navigates to the corresponding route and marks it active. Entering
   the editor hides the switcher; cancelling returns to the list with the switcher present.
3. **Contextual link** — on `/msp/inventory/sales-orders`, the "Manage layouts" link
   navigates to `/msp/document-templates/sales-order`.
4. **Regression** — existing designer flows (New Layout, edit, clone, set default, delete) and
   the Sales Orders PDF download/email still work; untouched code paths should be unaffected.

## Files touched

- `server/src/config/menuConfig.ts` — one menu item.
- `server/public/locales/en/msp/core.json` — one translation key.
- `packages/billing/src/components/billing-dashboard/documents/DocumentTemplatesPage.tsx` —
  type switcher in the list-view header.
- `packages/inventory/src/components/SalesOrdersManager.tsx` — contextual "Manage layouts" link.
