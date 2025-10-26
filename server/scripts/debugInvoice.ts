import { createTenantKnex } from '../src/lib/db/index.tsx';

async function run() {
  const targetInvoiceId = process.env.INVOICE_ID;
  if (!targetInvoiceId) {
    throw new Error('INVOICE_ID env var required');
  }

  const { knex, tenant } = await createTenantKnex();
  console.log('Tenant:', tenant);

  const invoice = await knex('invoices')
    .where({ invoice_id: targetInvoiceId })
    .first();
  console.log('Invoice:', invoice);

  if (!invoice) {
    return;
  }

  const items = await knex('invoice_items')
    .where({ invoice_id: targetInvoiceId })
    .orderBy('created_at', 'asc');
  console.log('Invoice items:', items);

  const itemDetails = await knex('invoice_item_details')
    .where({ invoice_id: targetInvoiceId })
    .orderBy('created_at', 'asc');
  console.log('Invoice item details:', itemDetails);

  const clientLines = await knex('client_contract_lines')
    .where({ client_id: invoice.client_id, tenant })
    .orderBy('created_at', 'asc');
  console.log('Client contract lines:', clientLines);

  const lineIds = clientLines.map((line) => line.client_contract_line_id);
  if (lineIds.length > 0) {
    const pricing = await knex('client_contract_line_pricing')
      .whereIn('client_contract_line_id', lineIds)
      .andWhere({ tenant });
    console.log('Client line pricing:', pricing);
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit(0));
