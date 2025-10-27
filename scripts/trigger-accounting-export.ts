#!/usr/bin/env ts-node
import { AccountingExportService } from '../server/src/lib/services/accountingExportService';
import { createAccountingExportBatch } from '../server/src/lib/actions/accountingExportActions';

async function main() {
  const [,, adapterType = 'quickbooks_online'] = process.argv;
  const batch = await createAccountingExportBatch({
    adapter_type: adapterType,
    export_type: 'invoice',
    filters: {},
    notes: 'Seeded via CLI'
  });
  console.log('Created batch', batch.batch_id);
  const service = await AccountingExportService.create();
  await service.appendLines(batch.batch_id, {
    lines: [
      {
        batch_id: batch.batch_id,
        invoice_id: 'TEST-INVOICE-ID',
        amount_cents: 12345,
        currency_code: 'USD',
        notes: 'Placeholder line'
      }
    ]
  });
  console.log('Added placeholder line');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
