# PRD — Extension Invoicing (Manual Invoice MVP)

- Slug: `extension-invoicing-manual-invoices`
- Date: `2026-01-14`
- Status: Draft

## Summary

Expose a minimal invoicing host API to extensions so an extension can create a **draft manual invoice** for a client inside the tenant where it is installed. Access is controlled via the existing extension **capabilities model** (granted at install time) and surfaced to extension code via a new `host.invoicing` interface.

## Problem

Extensions currently cannot create invoices using first-class platform primitives. Extension authors who need to bill for work performed, usage synced from third parties, or one-off charges must either:

- ask admins to create invoices manually in the UI, or
- attempt to call internal/private APIs via proxy patterns not designed for secure platform integration.

We want a least-privilege, capability-gated way for extensions to create invoices.

## Goals

- Add a new capability to grant invoice creation access: `cap:invoice.manual.create`.
- Provide a host API (`host.invoicing.createManualInvoice`) usable from extension WASM handlers.
- Reuse existing manual invoice creation logic (tax distribution, totals, numbering) where possible.
- Ensure invoices are created in the correct tenant and are attributable (user-driven where possible).

## Non-goals (MVP)

- Finalizing/sending invoices, taking payments, refunds, credit application.
- Updating or deleting invoices.
- Adding/editing invoice templates or PDFs.
- Creating service catalog items / services on the fly.
- A new UI flow in core Alga PSA (extensions can build their own UI and call their handler).

## Users and Primary Flows

**Primary persona:** Extension developer building billing automation for a tenant.

### Flow: Create a manual invoice from an extension UI

1. Tenant admin installs extension and grants `cap:invoice.manual.create`.
2. Extension UI collects `clientId` and line items (mapped to `serviceId`s known to the tenant).
3. UI calls the extension handler (e.g., `POST /create-invoice` via the usual proxy pattern).
4. Handler calls `host.invoicing.createManualInvoice(...)`.
5. Handler returns invoice identifiers/totals so the UI can show confirmation and deep-link to the invoice.

### Flow: Create a manual invoice from a non-UI integration

1. An external system triggers the extension handler (webhook, scheduled task, etc.).
2. Handler calls `host.invoicing.createManualInvoice(...)`.
3. Handler returns created invoice details for downstream sync/notification.

## Capability + Host API Design

### Capability

- New capability string: `cap:invoice.manual.create`
- Not granted by default; must be explicitly granted per install.

### Host bindings (TypeScript SDK)

Add a new `invoicing` namespace to `HostBindings`:

```ts
export interface ManualInvoiceItemInput {
  serviceId: string; // UUID (required)
  quantity: number;  // > 0
  description: string;
  rate: number;      // >= 0 (minor units; align with existing manual invoice API)
  isDiscount?: boolean;
  discountType?: 'percentage' | 'fixed';
  appliesToItemId?: string;
  appliesToServiceId?: string;
}

export interface CreateManualInvoiceInput {
  clientId: string; // UUID
  items: ManualInvoiceItemInput[]; // min 1
  // Header fields (MVP)
  invoiceDate?: string; // YYYY-MM-DD (defaults to "today" in tenant timezone)
  dueDate?: string;     // YYYY-MM-DD (defaults to invoiceDate for MVP)
  poNumber?: string | null; // optional client PO number snapshot
}

export type CreateManualInvoiceResult =
  | { success: true; invoice: { invoiceId: string; invoiceNumber: string; status: string; subtotal: number; tax: number; total: number } }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

export interface InvoicingHost {
  createManualInvoice(input: CreateManualInvoiceInput): Promise<CreateManualInvoiceResult>;
}
```

Notes:
- Keep the returned invoice payload intentionally small for the WASM boundary (IDs + totals). We can add richer “get invoice” capabilities later.
- Prefer camelCase in the JS SDK, and map to snake_case as needed on the wire.

## Host/Runner Wiring (How it’s exposed)

### Runner ↔ Server internal API

Mirror the scheduler host API pattern:

- Runner calls an internal host route on the Alga server:
  - `POST /api/internal/ext-invoicing/install/{installId}`
  - Auth via `x-runner-auth` token (`RUNNER_STORAGE_API_TOKEN` or `RUNNER_SERVICE_TOKEN`).
  - Server resolves `installId → tenantId` via `@ee/lib/extensions/installConfig`.
- Request includes an `operation` discriminator (`createManualInvoice`) and payload.

### User attribution + permissions (decision needed)

MVP decision: **capability-only authorization**.

- If `cap:invoice.manual.create` is granted, invoices can be created even when no end-user is present (e.g., scheduled tasks).
- Attribution uses a stopgap “system principal” strategy: invoice charge rows are created with a tenant user id fallback (first `users.user_id` for the tenant). This preserves tenant scoping but is not a final audit model; follow-up work should introduce a dedicated extension/system principal representation.

## Data / Integration Notes

- Reuse existing manual invoice logic where possible:
  - Prefer using lower-level helpers used by manual invoice creation (`persistManualInvoiceCharges`, tax distribution, totals update), since MVP does not require a user context.
- Required tenant data:
  - `clientId` must exist in tenant.
  - `serviceId` must exist in tenant (extensions must be configured with service IDs, or use existing tenant services).
  - Client billing email / tax settings requirements should match the core manual invoice behavior.

## Risks / Constraints

- Capability naming and future expansion: ensure the capability name leaves room for `cap:invoice.read`, `cap:invoice.finalize`, etc.
- Attribution and audit: invoice creation is sensitive; capability-only authorization may be surprising if not clearly surfaced in the install UI.
- Tax requirements: manual invoice creation may fail if client tax region/settings are incomplete; the host API must return clear errors.

## Open Questions

1. Attribution: what is the best representation for “created by extension” in invoice/audit records (installId marker vs dedicated service user)? (MVP uses tenant user id fallback; replace with a dedicated model.)
2. Should we expose currency selection in MVP (header-level `currencyCode`) or rely on tenant/client defaults only?

## Acceptance Criteria / Definition of Done

- [ ] A tenant can grant `cap:invoice.manual.create` to an extension install.
- [ ] An extension handler can call `host.invoicing.createManualInvoice(...)` and receive a success result with invoice identifiers.
- [ ] Created invoices are tenant-scoped and appear as manual draft invoices in existing invoice views.
- [ ] Unauthorized calls (missing capability, missing/invalid attribution inputs) fail with structured, debuggable errors.
- [ ] A sample extension exists in `sdk/samples/component/invoicing-demo/` demonstrating an extension UI creating a draft manual invoice.
