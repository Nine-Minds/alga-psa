import { createTenantKnex } from '../src/lib/db/index.tsx';
import { tenantDb } from '@alga-psa/db';

async function run() {
  const targetInvoiceId = process.env.INVOICE_ID;
  if (!targetInvoiceId) {
    throw new Error('INVOICE_ID env var required');
  }

  const { knex, tenant } = await createTenantKnex();
  const tenantFacade = tenantDb(knex, tenant);
  console.log('Tenant:', tenant);

  const invoice = await tenantFacade.table('invoices')
    .where({ invoice_id: targetInvoiceId })
    .first();
  console.log('Invoice:', invoice);

  if (!invoice) {
    return;
  }

  const items = await tenantFacade.table('invoice_charges')
    .where({ invoice_id: targetInvoiceId })
    .orderBy('created_at', 'asc');
  console.log('Invoice items:', items);

  const itemDetails = await tenantFacade.table('invoice_charge_details')
    .where({ invoice_id: targetInvoiceId })
    .orderBy('created_at', 'asc');
  console.log('Invoice item details:', itemDetails);

  const clientLines = await tenantFacade.table('client_contract_lines')
    .where({ client_id: invoice.client_id })
    .orderBy('created_at', 'asc');
  console.log('Client contract lines:', clientLines);

  const lineIds = clientLines.map((line) => line.client_contract_line_id);
  if (lineIds.length > 0) {
    const pricing = await tenantFacade
      .unscoped('client_contract_line_pricing', 'legacy invoice debug reads deprecated client contract pricing table')
      .where({ tenant })
      .whereIn('client_contract_line_id', lineIds);
    console.log('Client line pricing:', pricing);
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit(0));
