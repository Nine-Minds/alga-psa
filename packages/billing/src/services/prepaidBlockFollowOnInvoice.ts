import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { tenantDb } from '@alga-psa/db';
import * as invoiceService from './invoiceService';
import { TaxService } from './taxService';
import { prepaidBlockFeeDescription } from '../lib/billing/compute/prepaidBlockDescriptions';

export interface CreatePrepaidBlockFollowOnInvoiceInput {
  trx: Knex.Transaction;
  tenant: string;
  client: Record<string, any>;
  issuanceId: string;
  invoiceNumber: string;
  createdBy: string | null;
}

/**
 * Standalone draft invoice for a usage-triggered (exhaustion / threshold /
 * manual) Prepaid Block follow-on. One line, priced from the line's block
 * config in the CONTRACT currency (never the client default), linked to the
 * `scheduled` issuance. Everything block-side (pending block with D6 expiry,
 * issuance -> invoiced, gap-draw re-draw of the line) is
 * `persistPrepaidBlockIssuance`, the same routine the invoice generation path
 * uses, so the two entry points cannot drift apart.
 *
 * Caller holds the config row lock and the issuance row (lock order: alert,
 * config, issuance, blocks).
 */
export async function createPrepaidBlockFollowOnInvoice(
  input: CreatePrepaidBlockFollowOnInvoiceInput,
): Promise<{ invoiceId: string; blockId: string; invoiceNumber: string }> {
  const { trx, tenant, client, issuanceId, invoiceNumber, createdBy } = input;
  const db = tenantDb(trx, tenant);

  const issuance = await db.table('contract_line_block_issuances')
    .where({ issuance_id: issuanceId })
    .first();
  if (!issuance || issuance.status !== 'scheduled') {
    throw new Error(`Prepaid block issuance ${issuanceId} is ${issuance?.status ?? 'missing'}, not scheduled`);
  }

  const configQuery = db.table('contract_line_prepaid_blocks as cfg')
    .select(
      'cfg.block_minutes', 'cfg.block_price', 'cfg.sold_as_service_id', 'cfg.expiry_months',
      'ct.currency_code as contract_currency_code',
      'sc.service_name as sold_as_service_name',
    );
  db.tenantJoin(configQuery, 'contract_lines as cl', 'cl.contract_line_id', 'cfg.contract_line_id');
  db.tenantJoin(configQuery, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
  db.tenantJoin(configQuery, 'service_catalog as sc', 'sc.service_id', 'cfg.sold_as_service_id', { type: 'left' });
  const config = await configQuery.where('cfg.contract_line_id', issuance.contract_line_id).first();
  if (!config) throw new Error(`Prepaid block configuration for line ${issuance.contract_line_id} no longer exists`);
  if (!config.sold_as_service_id) throw new Error(`Prepaid block line ${issuance.contract_line_id} has no sold-as service`);
  if (!config.contract_currency_code) throw new Error(`Contract for prepaid block line ${issuance.contract_line_id} has no currency`);

  const scopeRows = await db.table('contract_line_services')
    .where({ contract_line_id: issuance.contract_line_id })
    .select('service_id');

  const blockMinutes = Number(config.block_minutes);
  const blockPrice = Number(config.block_price);
  const hours = blockMinutes / 60;
  const rate = Math.round(blockPrice / hours);
  const currencyCode = config.contract_currency_code as string;

  const invoiceId = uuidv4();
  const today = Temporal.Now.plainDateISO().toString();
  await db.table('invoices').insert({
    invoice_id: invoiceId,
    tenant,
    client_id: issuance.client_id,
    invoice_date: today,
    due_date: new Date().toISOString(),
    invoice_number: invoiceNumber,
    status: 'draft',
    currency_code: currencyCode,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    credit_applied: 0,
    is_manual: true,
    is_prepayment: false,
    credit_expiration_date: null,
    tax_source: 'internal',
  });

  const sessionLike = { user: { id: createdBy } } as any;
  await invoiceService.persistManualInvoiceCharges(
    trx,
    invoiceId,
    [{
      service_id: config.sold_as_service_id,
      quantity: hours,
      rate,
      description: prepaidBlockFeeDescription({ name: config.sold_as_service_name ?? 'Prepaid block', hours }),
      is_discount: false,
    }],
    client,
    sessionLike,
    tenant,
  );

  const charge = await db.table('invoice_charges')
    .where({ invoice_id: invoiceId, service_id: config.sold_as_service_id })
    .first();
  if (!charge) throw new Error('Prepaid block invoice line not found after creation');

  // The configured block price is authoritative; quantity x rounded unit rate
  // can differ by sub-unit rounding. Set before tax so tax is on the real price.
  await db.table('invoice_charges')
    .where({ item_id: charge.item_id })
    .update({
      net_amount: blockPrice,
      total_price: blockPrice,
      client_contract_id: issuance.client_contract_id ?? null,
    });

  await invoiceService.calculateAndDistributeTax(trx, invoiceId, client, new TaxService(), tenant);
  await invoiceService.updateInvoiceTotalsAndRecordTransaction(trx, invoiceId, client, tenant, invoiceNumber);

  const now = new Date().toISOString();
  await invoiceService.persistPrepaidBlockIssuance({
    tx: trx,
    tenant,
    invoiceId,
    invoiceChargeId: charge.item_id,
    charge: {
      issuance_id: issuanceId,
      contract_line_id: issuance.contract_line_id,
      serviceId: config.sold_as_service_id,
      block_minutes: blockMinutes,
      block_price: blockPrice,
      rate,
      currency_code: currencyCode,
      expiry_months: config.expiry_months == null ? null : Number(config.expiry_months),
      scope_service_ids: scopeRows.map((row: { service_id: string }) => row.service_id),
    },
    clientId: issuance.client_id,
    createdBy,
    now,
  });

  const block = await db.table('hour_blocks').where({ issuance_id: issuanceId }).first('block_id');
  return { invoiceId, blockId: block.block_id, invoiceNumber };
}
