# Invoice Finalization System

## Overview

The invoice finalization system provides a way to mark invoices as finalized once they have been formally issued to clients. This helps maintain data integrity and provides clear audit trails.

**Related Documentation:**
- [billing.md](./billing.md) - Overall billing system architecture
- [billing_cycles.md](./billing_cycles.md) - Billing cycle management
- [invoice_templates.md](./invoice_templates.md) - Invoice template system

## Finalization Triggers

An invoice becomes finalized when:
1. **Manual finalization** - User explicitly finalizes via UI action menu
2. **Email sending** - Future feature (not yet implemented — sending email now publishes the filed PDF to the client portal but does not set `finalized_at` or change invoice status)

**Important:** PDF download does NOT automatically finalize invoices. Users must explicitly finalize invoices through the UI action menu.

## Key Features

### 1. Separate Display
- Finalized invoices are displayed in a separate table from draft/pending invoices
- This provides clear visual separation between working and completed invoices

### 2. Status Management
- Invoices track their finalization status via the `finalized_at` timestamp
- Finalization derives the invoice status from the net payments already recorded against it, rather than always setting `'sent'` (see [Status on finalization](#status-on-finalization))
- Users can unfinalize an invoice if needed (moves it back to the main invoice list)
- Unfinalizing is distinct from reversing a billing period

### Status on finalization

Payments survive unfinalize, so an invoice can reach finalize with payments already recorded (for example, a paid invoice that was unfinalized, edited and finalized again). Finalize therefore computes the status with the shared `deriveInvoiceStatus` helper in `packages/billing/src/lib/balanceDue.ts`:

| Net recorded payments (`invoice_payments.amount`, refunds net out) | Resulting status |
|---|---|
| None (0) | `sent` |
| > 0, and `total_amount - credit_applied - net_paid > 0` | `partially_applied` |
| > 0, and `total_amount - credit_applied - net_paid <= 0` | `paid` |

- Credit is a separate input from payments, so credit alone never yields `paid`.
- The `invoice_finalized` audit row records the derived status in its `after` snapshot.
- Post-finalize credit auto-apply only uses the headroom left after net payments (`computeBalanceDue`).
- The same helper is used by external payment recording (`recordExternalPayment`) and by the REST `applyCredit` and `recordRefund` paths in `InvoiceService`. `draft`, `cancelled` and `void` are lifecycle states it never overwrites, so a refund recorded on a cancelled or void invoice keeps that status.
- The draft preview panel shows the net amount already paid (to users with `invoice:payment`) and warns when the draft total is below it, because finalizing would leave the invoice overpaid.
- Repair migration `20261124010000_repair_invoice_status_from_recorded_payments.cjs` re-derives the status of existing finalized invoices in `sent`/`paid`/`partially_applied` that have recorded payments. Drafts, cancelled and void invoices are untouched.

### 3. Credit Handling
**During finalization, the system automatically:**
- For **prepayment invoices** (negative totals): Creates credit tracking entries
- For **regular invoices**: Applies available credits to reduce the balance
- Handles credit expiration and allocation logic
- Records credit transactions in the ledger

### 4. Data Protection
**Current Implementation (Partial Protection):**
- Invoices with `'paid'` or `'cancelled'` status cannot be modified
- Line items cannot be added/modified for paid or cancelled invoices

**⚠️ Important:** The system does NOT currently block modifications based solely on `finalized_at` timestamp. Finalized invoices that are not yet paid or cancelled can still be modified. This may be enhanced in future versions to provide complete immutability for finalized invoices.

## Implementation Details

### Database Schema
The `invoices` table includes:
```sql
finalized_at TIMESTAMP WITH TIME ZONE
```

The `document_associations` entity-type check constraint now includes `invoice` and `sales_order`, allowing filed PDFs to be linked to their source entity and client.

The `documents` table carries three new provenance columns (nullable, forward-only):
- `source_template_id` — ID of the document template used to render the PDF
- `source_template_version` — version of that template at render time
- `rendered_locale` — locale resolved during rendering

See [IInvoice interface](../server/src/interfaces/invoice.interfaces.ts) line 15 for TypeScript type definition.

### Server Actions

**File Location:** [server/src/lib/actions/invoiceModification.ts](../server/src/lib/actions/invoiceModification.ts)

**Note:** The `invoiceActions.ts` file exists but is "intentionally left almost blank after refactoring" (line 58). The actual finalization logic is in `invoiceModification.ts`.

#### finalizeInvoice Function (lines 43-56)

```typescript
export async function finalizeInvoice(invoiceId: string): Promise<void> {
  const { knex } = await createTenantKnex();

  await knex('invoices')
    .where({ invoice_id: invoiceId })
    .update({
      finalized_at: new Date().toISOString(),
      status: 'sent'
    });
}
```

**Note:** This snippet shows the original simplified shape. Finalize now runs through `finalizeInvoiceWithKnex` in `packages/billing/src/actions/invoiceModification.ts`, shared by the UI action and REST `InvoiceService.finalizeInvoice`. It writes the status from `deriveInvoiceStatus` (see [Status on finalization](#status-on-finalization)), not a hard-coded `'sent'`.

**Complex Credit Handling (lines 109-253):**
The actual implementation includes sophisticated credit handling:
- For prepayment invoices (negative totals): Creates credit tracking entries
- For regular invoices: Applies available credits automatically
- Handles credit expiration logic
- Records transactions in the ledger

**⚠️ Audit Logging Status:** Audit logging code exists but is commented out (lines 93-106). The `auditLog()` function is imported but not currently used.

#### unfinalizeInvoice Function (lines 256-319)

```typescript
export async function unfinalizeInvoice(invoiceId: string): Promise<void> {
  const { knex } = await createTenantKnex();

  // Reverses credit applications and status changes
  await knex('invoices')
    .where({ invoice_id: invoiceId })
    .update({
      finalized_at: null,
      status: 'draft'
    });
}
```

**⚠️ Audit Logging Status:** Audit logging code exists but is commented out (lines 304-317).

### InvoiceService Class

The system also includes an API service layer at [server/src/lib/api/services/InvoiceService.ts](../server/src/lib/api/services/InvoiceService.ts):

**finalizeInvoice method (lines 536-604):**
- Includes validation and permission checks
- Publishes `'INVOICE_FINALIZED'` events (lines 591-600)
- Provides RESTful API interface
- Includes HATEOAS links for related operations

### UI Components

The invoice finalization UI is split across two dedicated components:

**Component Files:**
- [DraftsTab.tsx](../server/src/components/billing-dashboard/invoicing/DraftsTab.tsx) - Displays draft/pending invoices
- [FinalizedTab.tsx](../server/src/components/billing-dashboard/invoicing/FinalizedTab.tsx) - Displays finalized invoices

Both components import and use the finalization server actions:

```typescript
import { finalizeInvoice, unfinalizeInvoice } from '@/lib/actions/invoiceModification';
```

**Draft Filtering Logic (DraftsTab.tsx line 90):**
```typescript
const filteredInvoices = invoices.filter(inv =>
  !inv.finalized_at && normalizeStatus(inv.status) === 'draft'
);
```

**Finalized Filtering Logic (FinalizedTab.tsx line 65):**
```typescript
const filteredInvoices = invoices.filter(inv =>
  inv.finalized_at || inv.status !== 'draft'
);
```

**Bulk Operations:**
Both tabs support bulk finalize/unfinalize operations for multiple invoices simultaneously.

### Component IDs

**Actual Implementation (differs from original spec):**

1. **Action Menus:**
```typescript
id="draft-row-actions-${record.invoice_id}"      // In DraftsTab
id="finalized-row-actions-${record.invoice_id}"  // In FinalizedTab
```

2. **Tables:**
```typescript
id="invoice-drafts-table"      // In DraftsTab
id="invoices-finalized-table"  // In FinalizedTab
```

### PDF Generation Integration

**File Location:** [server/src/lib/actions/invoiceGeneration.ts](../server/src/lib/actions/invoiceGeneration.ts)

**Document-filing model:** Invoice PDFs are now filed as `documents` records with `document_associations` linking them to the source invoice and client. The filing follows a **refresh-until-issued** model:

- While the invoice has not been sent to the client, each download re-renders the PDF in place and updates the stored copy (refresh mode).
- Once the invoice is sent via email, `sendInvoiceEmailAction` / `InvoiceEmailHandler` call `publishGeneratedDocumentsToClient`, which flips the document's associations to client-visible and freezes the stored copy. All subsequent downloads — by the MSP and by the client from the portal — return this exact same file.
- A filing failure is logged and swallowed; the rendered bytes are still returned to the caller so download/email continues even if document filing fails.
- The `document_associations` table now accepts `invoice` as an entity type.
- New provenance columns on `documents` (`source_template_id`, `source_template_version`, `rendered_locale`) record what produced the stored PDF.

**Note:** The code snippet below reflects the previous simplified implementation shape. The current `downloadInvoicePDF` routes through `PDFGenerationService.generateAndStore` with the filing and refresh logic described above.

**Previous Implementation Shape (for reference):**

```typescript
// generateInvoicePDF (lines 644-671)
export async function generateInvoicePDF(invoiceId: string): Promise<{ file_id: string }> {
  const storageService = new StorageService();
  const pdfGenerationService = new PDFGenerationService(
    storageService,
    {
      pdfCacheDir: process.env.PDF_CACHE_DIR
    }
  );

  const fileRecord = await pdfGenerationService.generateAndStore({
    invoiceId
  });

  // NOTE: Does NOT automatically finalize the invoice
  return { file_id: fileRecord.file_id };
}

// downloadInvoicePDF also exists (line 673+)
```

**⚠️ Important:** PDF generation does NOT automatically call `finalizeInvoice()`. Users must manually finalize invoices through the UI action menu.

## Testing Requirements

1. **Server Action Tests:**
   - ✓ Test finalization with proper user context
   - ✓ Verify unfinalization logic
   - ⚠️ Audit log testing (commented out in code)
   - ✓ Test credit handling for prepayment invoices
   - ✓ Test credit application for regular invoices

2. **Protection Tests:**
   - ⚠️ Currently only paid/cancelled status blocks modifications
   - ⚠️ Finalized status does not guarantee immutability
   - ✓ Line items cannot be added/modified for paid or cancelled invoices

3. **UI Tests:**
   - ✓ Verify correct table separation (DraftsTab vs FinalizedTab)
   - ✓ Test bulk finalize/unfinalize operations
   - ✓ Validate component IDs match implementation

4. **Integration Tests:**
   - ⚠️ PDF generation does NOT automatically finalize
   - ⚠️ Audit trail is incomplete (logging commented out)
   - ✓ Check data consistency after credit operations
   - ✓ Test refresh-until-issued filing behavior
   - ✓ Test `publishGeneratedDocumentsToClient` freezes the stored document on email send

## Implementation Status

### ✓ Implemented Features:
- `finalized_at` timestamp tracking
- Manual finalization via UI
- Status on finalization derived from net recorded payments (`sent` / `partially_applied` / `paid`)
- Separate display for drafts and finalized invoices
- Credit handling for prepayment invoices
- Automatic credit application for regular invoices
- Bulk finalize/unfinalize operations
- Event publishing for finalization
- Invoice PDF filing with refresh-until-issued model (`PDFGenerationService.generateAndStore`)
- Client-portal PDF consistency: filed document published and frozen via `publishGeneratedDocumentsToClient` on email send
- Invoice and sales-order entity types in `document_associations`

### ⚠️ Partially Implemented:
- **Immutability protection** - Only for paid/cancelled, not finalized_at
- **Audit logging** - Code exists but is commented out
- **Email integration with finalization** - Sending email publishes the filed PDF to the client portal, but does not set `finalized_at` or auto-change invoice status

### ❌ Not Implemented:
- Automatic finalization on PDF download
- Automatic finalization on email send (setting `finalized_at` when invoice is emailed)
- Complete audit trail
- Finalization-based immutability

## Future Enhancements

1. **Complete Immutability Protection:**
   - Block all modifications for finalized invoices
   - Add checks for `finalized_at` in update operations
   - Comprehensive validation in invoiceModification.ts

2. **Audit Logging:**
   - Uncomment and activate audit logging code
   - Track all finalization state changes
   - Record reason for unfinalization
   - Maintain complete history

3. **Email Integration:**
   - ✓ PDF generation, filing, and client-portal publication on email send (implemented)
   - Auto-finalize on email send (set `finalized_at` when invoice is emailed) — still pending

4. **Approval Workflow:**
   - Optional approval before finalization
   - Multi-level approval process
   - Approval audit trail
   - Workflow runtime integration (already imported in code)

5. **PDF Auto-Finalization:**
   - Option to automatically finalize on PDF download
   - Configuration setting for this behavior
   - Update generateInvoicePDF to call finalizeInvoice

---

**Related Files:**
- [invoiceModification.ts](../server/src/lib/actions/invoiceModification.ts) - Finalization logic
- [InvoiceService.ts](../server/src/lib/api/services/InvoiceService.ts) - API service layer
- [DraftsTab.tsx](../server/src/components/billing-dashboard/invoicing/DraftsTab.tsx) - Draft invoices UI
- [FinalizedTab.tsx](../server/src/components/billing-dashboard/invoicing/FinalizedTab.tsx) - Finalized invoices UI
- [invoiceGeneration.ts](../server/src/lib/actions/invoiceGeneration.ts) - PDF generation
