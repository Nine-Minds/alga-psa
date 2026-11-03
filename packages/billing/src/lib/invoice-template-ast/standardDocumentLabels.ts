import type { TemplateI18nRef } from '@alga-psa/types';

/**
 * The standard document labels authors can place as translated text: each key
 * resolves in the recipient's language at render time (namespace `documents`),
 * with `defaultValue` as the English text the designer shows. Mirrors the
 * top-level strings under `labels` in server/public/locales/en/documents.json
 * (a test keeps the two in step).
 */
export const STANDARD_DOCUMENT_LABELS: readonly TemplateI18nRef[] = [
  { i18nKey: 'labels.acceptedBy', defaultValue: 'Accepted By' },
  { i18nKey: 'labels.amount', defaultValue: 'Amount' },
  { i18nKey: 'labels.authorizedBy', defaultValue: 'Authorized By' },
  { i18nKey: 'labels.billTo', defaultValue: 'Bill To' },
  { i18nKey: 'labels.billedTimeByTicket', defaultValue: 'Billed Time by Ticket' },
  { i18nKey: 'labels.cadenceTotal', defaultValue: '{{cadence}} Total' },
  { i18nKey: 'labels.currency', defaultValue: 'Currency' },
  { i18nKey: 'labels.date', defaultValue: 'Date' },
  { i18nKey: 'labels.description', defaultValue: 'Description' },
  { i18nKey: 'labels.discounts', defaultValue: 'Discounts' },
  { i18nKey: 'labels.dueDate', defaultValue: 'Due Date' },
  { i18nKey: 'labels.expectedShip', defaultValue: 'Expected Ship' },
  { i18nKey: 'labels.from', defaultValue: 'From' },
  { i18nKey: 'labels.fulfilled', defaultValue: 'Fulfilled' },
  { i18nKey: 'labels.fulfillment', defaultValue: 'Fulfillment' },
  { i18nKey: 'labels.hours', defaultValue: 'Hours' },
  { i18nKey: 'labels.invoice', defaultValue: 'Invoice' },
  { i18nKey: 'labels.invoiceNumber', defaultValue: 'Invoice #' },
  { i18nKey: 'labels.invoiceTitle', defaultValue: 'INVOICE' },
  { i18nKey: 'labels.issueDate', defaultValue: 'Issue Date' },
  { i18nKey: 'labels.locationSubtotal', defaultValue: 'Location Subtotal' },
  { i18nKey: 'labels.monthly', defaultValue: 'Monthly' },
  { i18nKey: 'labels.monthlyItems', defaultValue: 'Monthly Items' },
  { i18nKey: 'labels.monthlyTotal', defaultValue: 'Monthly Total' },
  { i18nKey: 'labels.notes', defaultValue: 'Notes' },
  { i18nKey: 'labels.oneTime', defaultValue: 'One-time' },
  { i18nKey: 'labels.oneTimeItems', defaultValue: 'One-time Items' },
  { i18nKey: 'labels.oneTimeTotal', defaultValue: 'One-time Total' },
  { i18nKey: 'labels.optional', defaultValue: 'Optional' },
  { i18nKey: 'labels.optionalIncluded', defaultValue: 'Optional (included)' },
  { i18nKey: 'labels.optionalSection', defaultValue: 'Optional (if selected)' },
  { i18nKey: 'labels.optionalSubtotal', defaultValue: 'Optional Subtotal' },
  { i18nKey: 'labels.optionalTotal', defaultValue: 'Optional if selected' },
  { i18nKey: 'labels.orderConfirmationTitle', defaultValue: 'ORDER CONFIRMATION' },
  { i18nKey: 'labels.orderDate', defaultValue: 'Order Date' },
  { i18nKey: 'labels.orderNumber', defaultValue: 'Order #' },
  { i18nKey: 'labels.orderTotal', defaultValue: 'Order Total' },
  { i18nKey: 'labels.ordered', defaultValue: 'Ordered' },
  { i18nKey: 'labels.packingSlipTitle', defaultValue: 'PACKING SLIP' },
  { i18nKey: 'labels.phase', defaultValue: 'Phase' },
  { i18nKey: 'labels.pickListTitle', defaultValue: 'PICK LIST' },
  { i18nKey: 'labels.picked', defaultValue: 'Picked' },
  { i18nKey: 'labels.poNumber', defaultValue: 'PO #' },
  { i18nKey: 'labels.preparedFor', defaultValue: 'Prepared For' },
  { i18nKey: 'labels.price', defaultValue: 'Price' },
  { i18nKey: 'labels.product', defaultValue: 'Product' },
  { i18nKey: 'labels.projectPhase', defaultValue: 'Project Phase' },
  { i18nKey: 'labels.qty', defaultValue: 'Qty' },
  { i18nKey: 'labels.quoteNumber', defaultValue: 'Quote #' },
  { i18nKey: 'labels.quoteTitle', defaultValue: 'QUOTE' },
  { i18nKey: 'labels.rate', defaultValue: 'Rate' },
  { i18nKey: 'labels.recurring', defaultValue: 'Recurring' },
  { i18nKey: 'labels.service', defaultValue: 'Service' },
  { i18nKey: 'labels.servicePeriod', defaultValue: 'Service Period' },
  { i18nKey: 'labels.shipDate', defaultValue: 'Ship Date' },
  { i18nKey: 'labels.shipTo', defaultValue: 'Ship To' },
  { i18nKey: 'labels.shipped', defaultValue: 'Shipped' },
  { i18nKey: 'labels.signature', defaultValue: 'Signature' },
  { i18nKey: 'labels.sku', defaultValue: 'SKU' },
  { i18nKey: 'labels.source', defaultValue: 'Source' },
  { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' },
  { i18nKey: 'labels.tax', defaultValue: 'Tax' },
  { i18nKey: 'labels.termsAndConditions', defaultValue: 'Terms & Conditions' },
  { i18nKey: 'labels.ticket', defaultValue: 'Ticket' },
  { i18nKey: 'labels.total', defaultValue: 'Total' },
  { i18nKey: 'labels.unitPrice', defaultValue: 'Unit Price' },
  { i18nKey: 'labels.validUntil', defaultValue: 'Valid Until' },
  { i18nKey: 'labels.version', defaultValue: 'Version' },
  { i18nKey: 'labels.yourPoNumber', defaultValue: 'Your PO #' },
  { i18nKey: 'labels.serialNumbers', defaultValue: 'Serial numbers' },
  { i18nKey: 'labels.allocatedSerialsNote', defaultValue: 'Allocated serial numbers; subject to change at fulfillment.' },
  { i18nKey: 'labels.stagingManifestTitle', defaultValue: 'PACKING MANIFEST' },
  { i18nKey: 'labels.boxNumber', defaultValue: 'Box no.' },
  { i18nKey: 'labels.project', defaultValue: 'Project' },
  { i18nKey: 'labels.client', defaultValue: 'Client' },
  { i18nKey: 'labels.task', defaultValue: 'Task' },
  { i18nKey: 'labels.status', defaultValue: 'Status' },
  { i18nKey: 'labels.sealedOn', defaultValue: 'Sealed' },
  { i18nKey: 'labels.sealedBy', defaultValue: 'Sealed by' },
  { i18nKey: 'labels.location', defaultValue: 'Location' },
  { i18nKey: 'labels.checked', defaultValue: 'Checked' },
  { i18nKey: 'labels.item', defaultValue: 'Item' },
  { i18nKey: 'labels.skuOrTag', defaultValue: 'SKU / tag' },
  { i18nKey: 'labels.serialNumber', defaultValue: 'Serial number' },
  { i18nKey: 'labels.owner', defaultValue: 'Owner' },
  { i18nKey: 'labels.ownerMsp', defaultValue: 'MSP' },
  { i18nKey: 'labels.ownerClient', defaultValue: 'Client' },
  { i18nKey: 'labels.statusOpen', defaultValue: 'Open' },
  { i18nKey: 'labels.statusSealed', defaultValue: 'Sealed' },
  { i18nKey: 'labels.rmaReturnSlipTitle', defaultValue: 'RMA RETURN SLIP' },
  { i18nKey: 'labels.device', defaultValue: 'Device' },
  { i18nKey: 'labels.vendor', defaultValue: 'Vendor' },
  { i18nKey: 'labels.vendorReference', defaultValue: 'Vendor reference' },
  { i18nKey: 'labels.asset', defaultValue: 'Asset' },
  { i18nKey: 'labels.assetTag', defaultValue: 'Asset tag' },
  { i18nKey: 'labels.replacementSerial', defaultValue: 'Replacement serial' },
  { i18nKey: 'labels.shipping', defaultValue: 'Shipping' },
  { i18nKey: 'labels.returnBy', defaultValue: 'Return by' },
  { i18nKey: 'labels.returnShipTo', defaultValue: 'Return ship to' },
];

const byKey = new Map(STANDARD_DOCUMENT_LABELS.map((label) => [label.i18nKey, label] as const));
// Several labels share English text (e.g. "Client" is both the client field and the
// client owner); text lookup resolves to the first, most general one.
const byText = new Map<string, TemplateI18nRef>();
for (const label of STANDARD_DOCUMENT_LABELS) {
  if (!byText.has(label.defaultValue)) byText.set(label.defaultValue, label);
}

export const getStandardDocumentLabel = (i18nKey: string): TemplateI18nRef | undefined => byKey.get(i18nKey);

/** The standard label whose English text is exactly `text`, for defaults that should translate. */
export const findStandardDocumentLabelByText = (text: string): TemplateI18nRef | undefined =>
  byText.get(text.trim());
