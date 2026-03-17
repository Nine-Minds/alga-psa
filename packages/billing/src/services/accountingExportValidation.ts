import { createTenantKnex } from '@alga-psa/db';
import { AccountingExportRepository } from '../repositories/accountingExportRepository';
import { AccountingMappingResolver } from './accountingMappingResolver';
import type { AccountingExportLine } from '@alga-psa/types';

type ChargeDetailProjection = {
  item_id: string;
  service_period_start?: string | Date | null;
  service_period_end?: string | Date | null;
  billing_timing?: 'arrears' | 'advance' | null;
};

type NormalizedRecurringPeriod = {
  service_period_start: string | null;
  service_period_end: string | null;
  billing_timing: 'arrears' | 'advance' | null;
};

function buildLineServicePeriodMetadata(
  line: Pick<AccountingExportLine, 'service_period_start' | 'service_period_end'>
): Record<string, string> | null {
  const metadata: Record<string, string> = {};

  if (line.service_period_start) {
    metadata.service_period_start = String(line.service_period_start);
  }
  if (line.service_period_end) {
    metadata.service_period_end = String(line.service_period_end);
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function mergeErrorMetadata(
  line: Pick<AccountingExportLine, 'service_period_start' | 'service_period_end'> | null | undefined,
  metadata?: Record<string, unknown> | null
): Record<string, unknown> | null {
  const lineMetadata = line ? buildLineServicePeriodMetadata(line) : null;
  if (!lineMetadata && !metadata) {
    return null;
  }

  return {
    ...(metadata ?? {}),
    ...(lineMetadata ?? {})
  };
}

export class AccountingExportValidation {
  static async ensureMappingsForBatch(batchId: string): Promise<void> {
    const repo = await AccountingExportRepository.create();
    const batch = await repo.getBatch(batchId);
    if (!batch) {
      throw new Error(`Export batch ${batchId} not found`);
    }

    const lines = await repo.listLines(batchId);
    const { knex } = await createTenantKnex();
    const validationTimestamp = new Date().toISOString();

    // Clear prior unresolved validation errors so each validation run reflects current mappings.
    await knex('accounting_export_errors')
      .where({
        tenant: batch.tenant,
        batch_id: batchId,
        resolution_state: 'open'
      })
      .update({
        resolution_state: 'resolved',
        resolved_at: validationTimestamp
      });

    const resolver = await AccountingMappingResolver.create();
    const adapterType = batch.adapter_type;
    const isQuickBooks = adapterType === 'quickbooks_online' || adapterType === 'quickbooks_csv';
    // Company sync and mapping resolution stay period-agnostic. Export validation is the first
    // accounting seam that should care about recurring timing, and it must use canonical
    // export-line service periods rather than invoice-header billing dates.

    const chargeIds = new Set<string>();
    const invoiceIds = new Set<string>();
    const firstLineByInvoice = new Map<string, string>();
    const lineById = new Map<string, AccountingExportLine>();

    for (const line of lines) {
      lineById.set(line.line_id, line);
      if (line.invoice_charge_id) {
        chargeIds.add(line.invoice_charge_id);
      }
      if (line.invoice_id) {
        invoiceIds.add(line.invoice_id);
        if (!firstLineByInvoice.has(line.invoice_id)) {
          firstLineByInvoice.set(line.invoice_id, line.line_id);
        }
      }
    }

    const charges =
      chargeIds.size > 0
        ? await knex('invoice_charges')
            .select('item_id', 'invoice_id', 'service_id', 'tax_region')
            .whereIn('item_id', Array.from(chargeIds))
            .andWhere({ tenant: batch.tenant })
        : [];
    const chargesById = new Map(charges.map((charge: any) => [charge.item_id, charge]));
    const chargeDetailRows =
      chargeIds.size > 0
        ? await knex('invoice_charge_details')
            .select('item_id', 'service_period_start', 'service_period_end', 'billing_timing')
            .whereIn('item_id', Array.from(chargeIds))
            .andWhere({ tenant: batch.tenant })
            .orderBy('service_period_start', 'asc')
        : [];
    const canonicalPeriodsByChargeId = new Map<string, NormalizedRecurringPeriod[]>();
    for (const detailRow of chargeDetailRows as ChargeDetailProjection[]) {
      const normalized = normalizeRecurringPeriod(detailRow);
      if (!normalized.service_period_start && !normalized.service_period_end) {
        continue;
      }
      const existing = canonicalPeriodsByChargeId.get(detailRow.item_id) ?? [];
      existing.push(normalized);
      canonicalPeriodsByChargeId.set(detailRow.item_id, existing);
    }

    const invoices =
      invoiceIds.size > 0
        ? await knex('invoices')
            .select('invoice_id', 'client_id', 'tax_source')
            .whereIn('invoice_id', Array.from(invoiceIds))
            .andWhere({ tenant: batch.tenant })
        : [];
    const invoiceTaxSourceById = new Map(invoices.map((row: any) => [row.invoice_id, row.tax_source]));
    const clientIds = new Set<string>();
    if (isQuickBooks) {
      for (const invoice of invoices) {
        if (invoice.client_id) {
          clientIds.add(invoice.client_id);
        }
      }
    }

    const clients =
      clientIds.size > 0
        ? await knex('clients')
            .select('client_id', 'payment_terms')
            .whereIn('client_id', Array.from(clientIds))
            .andWhere({ tenant: batch.tenant })
        : [];
    const clientsById = new Map(clients.map((row: any) => [row.client_id, row]));

    const checkedTaxRegions = new Set<string>();
    const missingTaxRegions = new Set<string>();
    const checkedPaymentTerms = new Set<string>();
    const missingPaymentTerms = new Set<string>();
    const missingClientRefs = new Set<string>();
    const checkedServiceMappings = new Set<string>();
    const missingServiceMappings = new Set<string>();

    const serviceIds = new Set<string>();
    for (const charge of charges) {
      if (charge.service_id) {
        serviceIds.add(charge.service_id);
      }
    }

    const services =
      serviceIds.size > 0
        ? await knex('service_catalog')
            .select('service_id', 'service_name')
            .whereIn('service_id', Array.from(serviceIds))
            .andWhere({ tenant: batch.tenant })
        : [];
    const serviceNameById = new Map<string, string>(
      services.map((row: any) => [row.service_id, row.service_name])
    );

    for (const line of lines) {
      if (!line.invoice_charge_id) {
        await repo.addError({
          batch_id: batchId,
          line_id: line.line_id,
          code: 'missing_charge_id',
          message: 'Line missing invoice_charge_id',
          metadata: mergeErrorMetadata(line)
        });
        continue;
      }

      const charge = chargesById.get(line.invoice_charge_id);
      if (!charge?.service_id) {
        await repo.addError({
          batch_id: batchId,
          line_id: line.line_id,
          code: 'missing_service',
          message: `Charge ${line.invoice_charge_id} missing associated service`,
          metadata: mergeErrorMetadata(line)
        });
        continue;
      }

      const canonicalPeriods = canonicalPeriodsByChargeId.get(line.invoice_charge_id) ?? [];
      if (canonicalPeriods.length > 0) {
        const exportPeriods = normalizeExportLinePeriods(line.payload);
        const exportSummaryStart = normalizeIsoString(line.service_period_start);
        const exportSummaryEnd = normalizeIsoString(line.service_period_end);
        const expectedSummaryStart = canonicalPeriods[0]?.service_period_start ?? null;
        const expectedSummaryEnd = canonicalPeriods[canonicalPeriods.length - 1]?.service_period_end ?? null;
        const summaryMismatch =
          exportSummaryStart !== expectedSummaryStart || exportSummaryEnd !== expectedSummaryEnd;
        const detailMismatch = !areRecurringPeriodsEqual(exportPeriods, canonicalPeriods);

        if (summaryMismatch || detailMismatch) {
          await repo.addError({
            batch_id: batchId,
            line_id: line.line_id,
            code: 'service_period_projection_mismatch',
            message: 'Export line service periods do not match canonical invoice charge details',
            metadata: {
              invoice_charge_id: line.invoice_charge_id,
              expected_summary: {
                service_period_start: expectedSummaryStart,
                service_period_end: expectedSummaryEnd
              },
              actual_summary: {
                service_period_start: exportSummaryStart,
                service_period_end: exportSummaryEnd
              },
              expected_detail_periods: canonicalPeriods,
              actual_detail_periods: exportPeriods
            }
          });
          continue;
        }
      }

      const serviceMappingKey = `${charge.service_id}:${batch.target_realm ?? 'default'}`;
      if (!checkedServiceMappings.has(serviceMappingKey)) {
        const mapping = await resolver.resolveServiceMapping({
          adapterType,
          targetRealm: batch.target_realm,
          serviceId: charge.service_id
        });

        if (!mapping && !missingServiceMappings.has(serviceMappingKey)) {
          const serviceName = serviceNameById.get(charge.service_id) ?? null;
          await repo.addError({
            batch_id: batchId,
            line_id: line.line_id,
            code: 'missing_service_mapping',
            message: serviceName
              ? `No mapping for service "${serviceName}"`
              : `No mapping for service ${charge.service_id}`,
            metadata: mergeErrorMetadata(line, {
              service_id: charge.service_id,
              service_name: serviceName
            })
          });
          missingServiceMappings.add(serviceMappingKey);
        }
        checkedServiceMappings.add(serviceMappingKey);
      }

      const invoiceTaxSource = line.invoice_id ? invoiceTaxSourceById.get(line.invoice_id) : null;
      const invoiceDelegatesTax =
        invoiceTaxSource === 'external' || invoiceTaxSource === 'pending_external';

      if (isQuickBooks && charge.tax_region && !invoiceDelegatesTax) {
        const cacheKey = `${charge.tax_region}:${batch.target_realm ?? 'default'}`;
        if (!checkedTaxRegions.has(cacheKey)) {
          const taxMapping = await resolver.resolveTaxCodeMapping({
            adapterType,
            taxRegionId: charge.tax_region,
            targetRealm: batch.target_realm
          });
          if (!taxMapping && !missingTaxRegions.has(cacheKey)) {
            await repo.addError({
              batch_id: batchId,
              line_id: line.line_id,
              code: 'missing_tax_mapping',
              message: `No tax code mapping for region ${charge.tax_region}`,
              metadata: mergeErrorMetadata(line, {
                tax_region: charge.tax_region
              })
            });
            missingTaxRegions.add(cacheKey);
          }
          checkedTaxRegions.add(cacheKey);
        }
      }
    }

    if (isQuickBooks) {
      if (adapterType === 'quickbooks_online' && !batch.target_realm && lines.length > 0) {
        const firstLine = lines[0];
        await repo.addError({
          batch_id: batchId,
          line_id: firstLine.line_id,
          code: 'missing_target_realm',
          message: 'QuickBooks exports require a target realm.',
          metadata: mergeErrorMetadata(firstLine)
        });
      }

      for (const invoice of invoices) {
        const clientRef = invoice.client_id ?? null;
        if (!clientRef) {
          const lineId = firstLineByInvoice.get(invoice.invoice_id);
          const line = lineId ? lineById.get(lineId) : null;
          if (lineId && !missingClientRefs.has(invoice.invoice_id)) {
            await repo.addError({
              batch_id: batchId,
              line_id: lineId,
              code: 'missing_client_reference',
              message: `Invoice ${invoice.invoice_id} is missing a client association`,
              metadata: mergeErrorMetadata(line, {
                invoice_id: invoice.invoice_id
              })
            });
            missingClientRefs.add(invoice.invoice_id);
          }
          continue;
        }

        const client = clientsById.get(clientRef);
        if (client?.payment_terms) {
          const paymentKey = `${client.payment_terms}:${batch.target_realm ?? 'default'}`;
          if (!checkedPaymentTerms.has(paymentKey)) {
            const termMapping = await resolver.resolvePaymentTermMapping({
              adapterType,
              paymentTermId: client.payment_terms,
              targetRealm: batch.target_realm
            });
            if (!termMapping && !missingPaymentTerms.has(paymentKey)) {
              const lineId = firstLineByInvoice.get(invoice.invoice_id);
              const line = lineId ? lineById.get(lineId) : null;
              if (lineId) {
                await repo.addError({
                  batch_id: batchId,
                  line_id: lineId,
                  code: 'missing_payment_term_mapping',
                  message: `No payment term mapping for ${client.payment_terms}`,
                  metadata: mergeErrorMetadata(line, {
                    client_id: clientRef,
                    payment_terms: client.payment_terms
                  })
                });
              }
              missingPaymentTerms.add(paymentKey);
            }
            checkedPaymentTerms.add(paymentKey);
          }
        }
      }
    }

    const errors = await repo.listErrors(batchId);
    const openErrors = errors.filter((item) => item.resolution_state === 'open');
    const cleanedStatus = openErrors.length === 0 ? 'ready' : 'needs_attention';
    await repo.updateBatchStatus(batchId, { status: cleanedStatus });
  }
}

function normalizeIsoString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeRecurringPeriod(input: {
  service_period_start?: unknown;
  service_period_end?: unknown;
  billing_timing?: unknown;
}): NormalizedRecurringPeriod {
  return {
    service_period_start: normalizeIsoString(input.service_period_start),
    service_period_end: normalizeIsoString(input.service_period_end),
    billing_timing:
      input.billing_timing === 'advance' || input.billing_timing === 'arrears'
        ? input.billing_timing
        : null
  };
}

function normalizeExportLinePeriods(
  payload: { recurring_detail_periods?: unknown } | null | undefined
): NormalizedRecurringPeriod[] {
  if (!payload || !Array.isArray(payload.recurring_detail_periods)) {
    return [];
  }

  return payload.recurring_detail_periods
    .map((period) => normalizeRecurringPeriod((period ?? {}) as Record<string, unknown>))
    .filter((period) => period.service_period_start || period.service_period_end)
    .sort(compareRecurringPeriods);
}

function areRecurringPeriodsEqual(
  left: NormalizedRecurringPeriod[],
  right: NormalizedRecurringPeriod[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index].service_period_start !== right[index].service_period_start ||
      left[index].service_period_end !== right[index].service_period_end ||
      left[index].billing_timing !== right[index].billing_timing
    ) {
      return false;
    }
  }

  return true;
}

function compareRecurringPeriods(left: NormalizedRecurringPeriod, right: NormalizedRecurringPeriod): number {
  if (left.service_period_start !== right.service_period_start) {
    return String(left.service_period_start ?? '').localeCompare(String(right.service_period_start ?? ''));
  }

  if (left.service_period_end !== right.service_period_end) {
    return String(left.service_period_end ?? '').localeCompare(String(right.service_period_end ?? ''));
  }

  return String(left.billing_timing ?? '').localeCompare(String(right.billing_timing ?? ''));
}
