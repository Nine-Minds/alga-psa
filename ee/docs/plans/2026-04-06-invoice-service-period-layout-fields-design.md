# Invoice Service Period Layout Fields Design

Date: 2026-04-06
Status: Approved

## Summary

Add first-class invoice layout fields for canonical recurring invoice service periods and improve line-item table discoverability for existing per-row service period data.

Chosen scope:
- Header-level bindings for recurring invoice service period start, end, and formatted label
- Table suggestion support for row-level service period fields
- No canonical detail-period list rendering in V1

## Problem

Invoice layouts currently do not expose a first-class header binding for service periods, even though recurring invoices already carry canonical recurring service period summary data upstream.

At the same time, line items already contain service period summary fields in the renderer view model, but the invoice designer does not make those row fields discoverable in the table editor.

This makes it difficult for template authors to show service periods consistently on invoices.

## Goals

1. Expose canonical recurring invoice service periods as header-level invoice layout fields.
2. Provide a formatted service period label suitable for printed invoices.
3. Make row-level service period fields easy to discover in dynamic table authoring.
4. Keep the implementation canonical and avoid inventing service periods for invoices that do not have them.

## Non-Goals

1. Rendering nested canonical `recurringDetailPeriods` lists in templates.
2. Deriving header-level service periods from line items.
3. Automatically changing shipped standard invoice templates.
4. Adding row-level formatted service period labels in V1.

## Approved Product Decisions

### Scope

Approved option: **B**
- Header + line items
- No nested canonical detail-period rendering

### Missing Header Period Behavior

Approved option: **A**
- If the invoice does not have canonical recurring invoice service period summary data, the header fields resolve to blank/null.
- No fallback to line-item aggregation.

### Formatted Label

Approved format: **A**
- `Jan 1, 2025 - Feb 1, 2025`

## Design

### 1. Data Contract and Binding Model

Add three invoice-level renderer fields:
- `recurringServicePeriodStart?: string | null`
- `recurringServicePeriodEnd?: string | null`
- `recurringServicePeriodLabel?: string | null`

These fields are populated only from canonical recurring invoice summary fields already produced upstream:
- `recurring_service_period_start`
- `recurring_service_period_end`

For line-item tables, keep the existing row model unchanged and make these paths discoverable:
- `item.servicePeriodStart`
- `item.servicePeriodEnd`
- `item.billingTiming`

### 2. UX / Designer Behavior

#### Header fields

Expose these in the invoice designer field picker under the Invoice category:
- Recurring Service Period Start
- Recurring Service Period End
- Recurring Service Period

The formatted label field should render like:
- `Jan 1, 2025 - Feb 1, 2025`

Behavior:
- Populated only when canonical recurring header period data exists
- Blank/null otherwise
- Derived from canonical invoice header dates, not from line items

#### Table discoverability

In the table editor, add row binding suggestions for:
- `item.servicePeriodStart`
- `item.servicePeriodEnd`
- `item.billingTiming`

This is a discoverability enhancement only. The row data already exists in the renderer model.

### 3. Implementation Details

#### Renderer view model

Update:
- `packages/types/src/lib/invoice-renderer/types.ts`

Add optional top-level fields for recurring service period start, end, and label.

#### Adapter mapping

Update:
- `packages/billing/src/lib/adapters/invoiceAdapters.ts`

Map canonical invoice summary fields from source invoice data into the renderer model. Build the formatted label in the adapter layer so preview and PDF rendering share one source of truth.

#### Binding catalog

Update:
- `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts`

Add value bindings for:
- `recurringServicePeriodStart`
- `recurringServicePeriodEnd`
- `recurringServicePeriodLabel`

#### Designer field catalog

Update:
- `packages/billing/src/components/invoice-designer/fields/fieldCatalog.ts`

Add first-class field definitions for the new invoice-level fields.

#### Preview support

Update:
- `packages/billing/src/components/invoice-designer/preview/previewBindings.ts`

Resolve the three new invoice bindings so designer preview matches runtime rendering.

#### Table suggestions

Update:
- `packages/billing/src/components/invoice-designer/inspector/widgets/TableEditorWidget.tsx`

Include service period-related `item.*` suggestions in row binding suggestions.

### 4. Error Handling and Behavior Rules

#### Canonical-only header behavior

Rules:
- If both canonical header dates are absent, all three header bindings resolve to `null`
- Do not derive from line items
- Do not inject placeholders in the renderer model

#### Label formatting behavior

Rules:
- Start + end present -> produce formatted label
- One side missing -> label is `null`
- Invalid date strings -> fail safely to `null` or equivalent non-throwing behavior in the adapter helper

#### Table row behavior

Rules:
- Missing row service period values render like any other missing row value
- `item.billingTiming` remains a raw text value in V1

## Files Expected to Change

- `packages/types/src/lib/invoice-renderer/types.ts`
- `packages/billing/src/lib/adapters/invoiceAdapters.ts`
- `packages/billing/src/lib/adapters/invoiceAdapters.test.ts`
- `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts`
- `packages/billing/src/components/invoice-designer/fields/fieldCatalog.ts`
- `packages/billing/src/components/invoice-designer/preview/previewBindings.ts`
- `packages/billing/src/components/invoice-designer/preview/previewBindings.test.ts`
- `packages/billing/src/components/invoice-designer/inspector/widgets/TableEditorWidget.tsx`

## Testing Plan

1. **Adapter tests**
   - Maps canonical recurring header service period start/end into renderer view model
   - Produces formatted label when both dates are present
   - Leaves fields null when canonical header period is absent

2. **Preview binding tests**
   - Resolves new header bindings correctly
   - Formats label correctly
   - Returns null when canonical header fields are missing

3. **Table editor tests**
   - Suggested row bindings include `item.servicePeriodStart`, `item.servicePeriodEnd`, and `item.billingTiming`

4. **Regression checks**
   - Existing templates continue to load and render unchanged
   - Standard templates remain structurally unchanged unless explicitly edited later

## Risks

1. **Date formatting inconsistencies**
   - Mitigation: centralize label construction in one adapter helper

2. **Ambiguity between header and row service periods**
   - Mitigation: use explicit naming and field descriptions in the field catalog

3. **Historical invoices without canonical recurring metadata**
   - Mitigation: resolve header bindings to null and avoid fallback derivation

## Recommendation

Implement the approved V1 scope exactly as designed:
- canonical header bindings for recurring invoice service periods
- formatted header label
- row-level table field discoverability
- no fallback derivation and no nested canonical detail-period rendering
