export const infrastructureFloor = Object.freeze([
  'server/src/test/infrastructure/billing/invoices/invoiceDueDate.test.ts',
  'server/src/test/infrastructure/billing/invoices/manualInvoice.test.ts',
  'server/src/test/infrastructure/billing/invoices/billingInvoiceGeneration_tax.test.ts',
  'server/src/test/infrastructure/billing/tax/taxRoundingBehavior.test.ts',
  'server/src/test/infrastructure/billing/credits/creditApplication.test.ts',
  'server/src/test/infrastructure/billing/quotes/quoteInfrastructure.test.ts',
  'server/src/test/infrastructure/billing/quotes/quoteConversion.test.ts',
].sort());

// The producer supplies its reconciled collection; the aggregate independently
// supplies the checkout inventory. Neither consumer takes policy from artifacts.
export function requiredInfrastructureFiles(candidates, mode) {
  if (!['full', 'tier1'].includes(mode)) throw new Error('Invalid infrastructure coverage mode');
  for (const file of infrastructureFloor) {
    if (!candidates.includes(file)) throw new Error(`Mandatory infrastructure floor was not collected: ${file}`);
  }
  return mode === 'full' ? [...candidates].sort() : [...infrastructureFloor];
}
