# Invoice Finalization System

## Overview

The invoice finalization system provides a way to mark invoices as finalized once they have been formally issued to clients. This helps maintain data integrity and provides clear audit trails.

## Finalization Triggers

An invoice becomes finalized when:
1. It is downloaded as a PDF
2. It is sent via email (future feature)

## Key Features

### 1. Separate Display
- Finalized invoices are displayed in a separate table from draft/pending invoices
- This provides clear visual separation between working and completed invoices

### 2. Status Management
- Invoices track their finalization status via the `finalized_at` timestamp
- Users can unfinalize an invoice if needed (moves it back to the main invoice list)
- Unfinalizing is distinct from reversing a billing period

### 3. Data Protection
- Finalized invoices cannot be modified:
  - No adding new line items
  - No modifying existing items
  - No changes to amounts or details
- This ensures data integrity and audit compliance

## Implementation Details

### Database Schema
The `invoices` table includes:
```sql
finalized_at TIMESTAMP WITH TIME ZONE
```

### Server Actions

Create new server actions in `/server/src/lib/actions/invoiceActions.ts`:

```typescript
'use server'

export async function finalizeInvoice(invoiceId: string): Promise<void> {
  const { knex } = await createTenantKnex();
  const currentUser = await getCurrentUser();
  
  if (!currentUser) {
    throw new Error('Unauthorized');
  }

  await knex.transaction(async (trx) => {
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        finalized_at: new Date().toISOString(),
        updated_by: currentUser.id
      });

    // Record audit log
    await trx('audit_logs').insert({
      audit_id: uuidv4(),
      user_id: currentUser.id,
      operation: 'finalize_invoice',
      table_name: 'invoices',
      record_id: invoiceId,
      tenant: tenant
    });
  });
}

export async function unfinalizeInvoice(invoiceId: string): Promise<void> {
  const { knex } = await createTenantKnex();
  const currentUser = await getCurrentUser();
  
  if (!currentUser) {
    throw new Error('Unauthorized');
  }

  await knex.transaction(async (trx) => {
    await trx('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        finalized_at: null,
        updated_by: currentUser.id
      });

    // Record audit log
    await trx('audit_logs').insert({
      audit_id: uuidv4(),
      user_id: currentUser.id,
      operation: 'unfinalize_invoice',
      table_name: 'invoices',
      record_id: invoiceId,
      tenant: tenant
    });
  });
}
```

### UI Components

Update the Invoices component to use server actions and follow UI standards:

```typescript
// In Invoices.tsx
import { finalizeInvoice, unfinalizeInvoice } from '@/lib/actions/invoiceActions';

// Action menu items following standards
<DropdownMenuContent align="end">
  <DropdownMenuItem
    id={`finalize-invoice-menu-item-${record.invoice_id}`}
    onClick={async (e) => {
      e.stopPropagation();
      try {
        await finalizeInvoice(record.invoice_id);
        // Refresh data
        loadData();
      } catch (error) {
        console.error('Failed to finalize invoice:', error);
      }
    }}
  >
    Finalize Invoice
  </DropdownMenuItem>
</DropdownMenuContent>
```

### Component IDs

Following the UI reflection system guidelines:

1. Action Menu:
```typescript
id="invoice-actions-menu-${invoice.invoice_id}"
```

2. Menu Items:
```typescript
id="finalize-invoice-menu-item-${invoice.invoice_id}"
id="unfinalize-invoice-menu-item-${invoice.invoice_id}"
id="download-pdf-menu-item-${invoice.invoice_id}"
```

3. Tables:
```typescript
id="draft-invoices-table"
id="finalized-invoices-table"
```

### PDF Generation Integration

Update the PDF generation server action to finalize the invoice:

```typescript
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

  // Finalize the invoice after successful PDF generation
  await finalizeInvoice(invoiceId);
  
  return { file_id: fileRecord.file_id };
}
```

## Testing Requirements

1. Server Action Tests:
   - Test finalization with proper user context
   - Verify unfinalization permissions and logic
   - Check audit log entries are created
   - Test error handling for unauthorized access

2. Protection Tests:
   - Verify that finalized invoices cannot be modified
   - Test all modification paths are properly blocked
   - Ensure line items cannot be added/modified

3. UI Tests:
   - Verify correct table separation
   - Test all control states (enabled/disabled)
   - Ensure proper error messages for blocked actions
   - Validate component IDs follow standards

4. Integration Tests:
   - Test PDF generation with finalization
   - Verify audit trail completeness
   - Check data consistency after operations

## Migration Plan

1. Database Updates:
   - Finalized_at column already exists
   - No schema changes needed

2. Code Updates:
   - Add new server actions in invoiceActions.ts
   - Update Invoices.tsx component
   - Implement protection mechanisms
   - Add audit logging

3. Testing:
   - Unit tests for server actions
   - Integration tests for workflow
   - UI tests for new interface

4. Deployment:
   - No database migration needed
   - Deploy code changes
   - Monitor for any issues with existing invoices

## Future Enhancements

1. Email Integration:
   - Add email sending capability
   - Integrate with finalization system
   - Include PDF generation

2. Approval Workflow:
   - Optional approval before finalization
   - Multi-level approval process
   - Approval audit trail

3. Batch Operations:
   - Bulk finalization of multiple invoices
   - Batch PDF generation
   - Mass email sending

4. Enhanced Audit Trail:
   - Track all finalization state changes
   - Record reason for unfinalization
   - Maintain complete history