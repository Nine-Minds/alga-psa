import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { getAccountingSyncSettings, resolveDefaultRealm } from './accountingSyncSettings';
import { AccountingMappingResolver } from '../accountingMappingResolver';

/**
 * Finalize-time export readiness: when an invoice WILL auto-export to QBO,
 * refuse to finalize it if the export would deterministically fail validation
 * (a line without a service, or a service without a QBO item mapping).
 * Failing here — in the screen the user is looking at, with the lines named —
 * beats failing an hour later in the sync exception inbox and teaching staff
 * that "finalized" doesn't mean "exported".
 *
 * Only deterministic validation findings block; infrastructure errors during
 * the check fail OPEN (finalize proceeds, batch validation remains the net).
 */

const SYNC_ADAPTER_TYPE = 'quickbooks_online';

// LEVERAGE: pattern edition-gate — same local isEnterpriseEdition as syncProducers.ts
function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

// LEVERAGE: pattern date-only-normalization — same helper as syncProducers.ts
function toDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function truncateDescription(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : '(no description)';
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

export class InvoiceExportReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceExportReadinessError';
  }
}

export async function assertInvoiceExportReady(
  knex: Knex,
  tenant: string,
  invoiceId: string
): Promise<void> {
  let blockers: string[];
  try {
    blockers = await collectExportBlockers(knex, tenant, invoiceId);
  } catch (error) {
    logger.warn('[accountingSync] Export readiness check errored; allowing finalize', {
      tenant,
      invoiceId,
      error: error instanceof Error ? error.message : error
    });
    return;
  }

  if (blockers.length > 0) {
    throw new InvoiceExportReadinessError(
      `This invoice can't be finalized because it would fail QuickBooks export: ${blockers.join('; ')}. ` +
        'Assign services and QuickBooks item mappings to these lines, or turn off auto-sync, then finalize again.'
    );
  }
}

async function collectExportBlockers(knex: Knex, tenant: string, invoiceId: string): Promise<string[]> {
  if (!isEnterpriseEdition()) {
    return [];
  }

  const settings = await getAccountingSyncSettings(knex, tenant);
  if (!settings.autoSyncEnabled) {
    return [];
  }

  const invoice = await knex('invoices')
    .where({ invoice_id: invoiceId, tenant })
    .select('invoice_type', 'is_prepayment', 'invoice_date')
    .first();
  if (!invoice) {
    return [];
  }

  // Prepayments never export; invoices dated before the go-live cutoff never
  // auto-enqueue. Neither can fail an export they will not attempt.
  if (invoice.invoice_type === 'prepayment' || invoice.is_prepayment) {
    return [];
  }
  if (settings.autoSyncStartDate) {
    const invoiceDate = toDateOnly(invoice.invoice_date);
    if (invoiceDate && invoiceDate < settings.autoSyncStartDate.slice(0, 10)) {
      return [];
    }
  }

  const realm = await resolveDefaultRealm(knex, tenant);
  if (!realm) {
    return [];
  }

  const charges: Array<{ item_id: string; service_id: string | null; description: string | null }> =
    await knex('invoice_charges')
      .where({ invoice_id: invoiceId, tenant })
      .select('item_id', 'service_id', 'description');

  // Consolidated fixed-plan parent charges intentionally carry no service_id —
  // their services live in invoice_charge_details children. Only a serviceless
  // charge with no children is a user-fixable gap (a manual/discount line
  // someone forgot to classify).
  const chargeIdsForDetailLookup = charges.filter((c) => !c.service_id).map((c) => c.item_id);
  const consolidatedParents = new Set<string>(
    chargeIdsForDetailLookup.length > 0
      ? (
          await knex('invoice_charge_details')
            .whereIn('item_id', chargeIdsForDetailLookup)
            .andWhere({ tenant })
            .select('item_id')
        ).map((row: { item_id: string }) => row.item_id)
      : []
  );

  const blockers: string[] = [];

  const serviceless = charges.filter((charge) => !charge.service_id && !consolidatedParents.has(charge.item_id));
  if (serviceless.length > 0) {
    const samples = serviceless.slice(0, 3).map((charge) => `"${truncateDescription(charge.description)}"`);
    blockers.push(
      `${serviceless.length} line${serviceless.length === 1 ? ' has' : 's have'} no service assigned (${samples.join(', ')})`
    );
  }

  const resolver = new AccountingMappingResolver(knex);
  const serviceIds = [...new Set(charges.map((charge) => charge.service_id).filter((id): id is string => Boolean(id)))];
  const unmappedServiceIds: string[] = [];
  for (const serviceId of serviceIds) {
    const mapping = await resolver.resolveServiceMapping({
      adapterType: SYNC_ADAPTER_TYPE,
      serviceId,
      targetRealm: realm
    });
    if (!mapping) {
      unmappedServiceIds.push(serviceId);
    }
  }

  if (unmappedServiceIds.length > 0) {
    const serviceRows: Array<{ service_id: string; service_name: string | null }> = await knex('service_catalog')
      .whereIn('service_id', unmappedServiceIds)
      .andWhere({ tenant })
      .select('service_id', 'service_name');
    const nameById = new Map(serviceRows.map((row) => [row.service_id, row.service_name]));
    const names = unmappedServiceIds.map((id) => `"${nameById.get(id) ?? id}"`);
    blockers.push(
      `${unmappedServiceIds.length} service${unmappedServiceIds.length === 1 ? ' has' : 's have'} no QuickBooks item mapping (${names.join(', ')})`
    );
  }

  return blockers;
}
