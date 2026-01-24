# Invoicing Host API Guide (Manual Invoice MVP)

This guide explains how to use the `cap:invoice.manual.create` capability to create **draft manual invoices** from your extension.

## Overview

The Invoicing Host API lets extension handlers create a draft invoice in the tenant where the extension is installed. Typical use cases:

- One-off charges for work performed by the extension
- Usage-based billing synced from third parties (create invoices from scheduled jobs/webhooks)
- UI-driven “Create Invoice” actions inside an extension iframe

## Prerequisites

Your extension must declare the `cap:invoice.manual.create` capability in its manifest (and the tenant must grant it at install time):

```json
{
  "capabilities": ["cap:invoice.manual.create", "cap:log.emit"]
}
```

## API Reference

### InvoicingHost Interface

```ts
interface InvoicingHost {
  createManualInvoice(input: CreateManualInvoiceInput): Promise<CreateManualInvoiceResult>;
}
```

### Types

```ts
interface ManualInvoiceItemInput {
  serviceId: string;   // UUID (required)
  quantity: number;    // > 0
  description: string; // required
  rate: number;        // >= 0 (minor units)
  isDiscount?: boolean;
  discountType?: 'percentage' | 'fixed';
  appliesToItemId?: string;
  appliesToServiceId?: string;
}

interface CreateManualInvoiceInput {
  clientId: string; // UUID (required)
  items: ManualInvoiceItemInput[]; // min 1
  invoiceDate?: string; // YYYY-MM-DD (defaults to "today")
  dueDate?: string;     // YYYY-MM-DD (defaults to invoiceDate)
  poNumber?: string | null;
}

type CreateManualInvoiceResult =
  | { success: true; invoice: { invoiceId: string; invoiceNumber: string; status: string; subtotal: number; tax: number; total: number } }
  | { success: false; error: string; fieldErrors?: Record<string, string> };
```

## Usage Example

```ts
import type { HostBindings } from '@alga-psa/extension-runtime';

export async function createInvoice(host: HostBindings, clientId: string, serviceId: string) {
  const result = await host.invoicing.createManualInvoice({
    clientId,
    invoiceDate: '2026-01-14',
    dueDate: '2026-01-14',
    poNumber: 'PO-123',
    items: [
      { serviceId, quantity: 1, description: 'Implementation work', rate: 15000 },
    ],
  });

  if (!result.success) {
    await host.logging.error(result.error);
    return result;
  }

  await host.logging.info(`Created invoice ${result.invoice.invoiceNumber} (${result.invoice.invoiceId})`);
  return result;
}
```

## Error Handling

When `success: false`, you may receive `fieldErrors` for input validation failures:

```ts
if (!result.success) {
  if (result.fieldErrors) {
    for (const [field, message] of Object.entries(result.fieldErrors)) {
      console.error(`${field}: ${message}`);
    }
  }
}
```

## See Also

- [Extension Manifest Reference](../references/manifest.md)

