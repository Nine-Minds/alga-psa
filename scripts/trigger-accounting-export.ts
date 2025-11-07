#!/usr/bin/env ts-node
import { AccountingExportService } from '../server/src/lib/services/accountingExportService';
import { createAccountingExportBatch } from '../server/src/lib/actions/accountingExportActions';

const USAGE = `
Usage: pnpm ts-node scripts/trigger-accounting-export.ts [adapterType] [realm]

adapterType:
  quickbooks_online  (default)
  quickbooks_desktop
  xero

realm:
  Required for quickbooks_online and xero exports. Pass the QuickBooks realm ID or Xero connection ID.
  You can also set ACCOUNTING_EXPORT_TARGET_REALM in your environment.
`;

async function main() {
  const [, , rawAdapterArg, rawRealmArg] = process.argv;

  if (rawAdapterArg === '--help' || rawAdapterArg === '-h') {
    console.log(USAGE.trim());
    process.exit(0);
  }

  const adapterArg = rawAdapterArg ?? 'quickbooks_online';
  const adapterType = adapterArg as 'quickbooks_online' | 'quickbooks_desktop' | 'xero';
  const targetRealm = rawRealmArg ?? process.env.ACCOUNTING_EXPORT_TARGET_REALM ?? '';

  if ((adapterType === 'quickbooks_online' || adapterType === 'xero') && !targetRealm) {
    console.error(
      `Adapter "${adapterType}" requires a target realm/connection. Pass it as the second argument or set ACCOUNTING_EXPORT_TARGET_REALM.`
    );
    console.error('Run with --help for usage examples.');
    process.exit(1);
  }

  console.log(`Creating ${adapterType} batch${targetRealm ? ` for realm ${targetRealm}` : ''}…`);
  const batch = await createAccountingExportBatch({
    adapter_type: adapterType,
    target_realm: targetRealm || null,
    export_type: 'invoice',
    filters: {},
    notes: 'Seeded via CLI (replace placeholder data before delivery)'
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
  if (adapterType === 'quickbooks_online') {
    console.log(
      'Reminder: confirm QuickBooks mappings (services, tax codes, payment terms) for the selected realm before executing this batch.'
    );
  }
  console.log('Update the batch lines and run validation before delivering this export.');
}

main().catch((err) => {
  console.error(err);
  console.error('Run with --help for usage examples.');
  process.exit(1);
});
