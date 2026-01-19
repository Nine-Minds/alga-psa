import { createTenantKnex } from '@alga-psa/db';
import { AccountingExportRepository } from '../../repositories/accountingExportRepository';
import { AccountingExportService } from '../../services/accountingExportService';
import { AccountingMappingResolver } from '../../services/accountingMappingResolver';

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

    const chargeIds = new Set<string>();
    const invoiceIds = new Set<string>();
    const firstLineByInvoice = new Map<string, string>();

    for (const line of lines) {
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

    const charges = chargeIds.size > 0
      ? await knex('invoice_charges')
          .select('item_id', 'invoice_id', 'service_id', 'tax_region')
          .whereIn('item_id', Array.from(chargeIds))
          .andWhere({ tenant: batch.tenant })
      : [];
    const chargesById = new Map(charges.map((charge) => [charge.item_id, charge]));

    const invoices = invoiceIds.size > 0
      ? await knex('invoices')
          .select('invoice_id', 'client_id', 'tax_source')
          .whereIn('invoice_id', Array.from(invoiceIds))
          .andWhere({ tenant: batch.tenant })
      : [];
    const invoiceTaxSourceById = new Map(invoices.map((row) => [row.invoice_id, row.tax_source]));
    const clientIds = new Set<string>();
    if (isQuickBooks) {
      for (const invoice of invoices) {
        if (invoice.client_id) {
          clientIds.add(invoice.client_id);
        }
      }
    }

    const clients = clientIds.size > 0
      ? await knex('clients')
          .select('client_id', 'payment_terms')
          .whereIn('client_id', Array.from(clientIds))
          .andWhere({ tenant: batch.tenant })
      : [];
    const clientsById = new Map(clients.map((row) => [row.client_id, row]));

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

    const services = serviceIds.size > 0
      ? await knex('service_catalog')
          .select('service_id', 'service_name')
          .whereIn('service_id', Array.from(serviceIds))
          .andWhere({ tenant: batch.tenant })
      : [];
    const serviceNameById = new Map<string, string>(services.map((row: any) => [row.service_id, row.service_name]));

    for (const line of lines) {
      if (!line.invoice_charge_id) {
        await repo.addError({
          batch_id: batchId,
          line_id: line.line_id,
          code: 'missing_charge_id',
          message: 'Line missing invoice_charge_id'
        });
        continue;
      }

      const charge = chargesById.get(line.invoice_charge_id);
      if (!charge?.service_id) {
        await repo.addError({
          batch_id: batchId,
          line_id: line.line_id,
          code: 'missing_service',
          message: `Charge ${line.invoice_charge_id} missing associated service`
        });
        continue;
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
            message: serviceName ? `No mapping for service "${serviceName}"` : `No mapping for service ${charge.service_id}`,
            metadata: {
              service_id: charge.service_id,
              service_name: serviceName
            }
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
              message: `No tax code mapping for region ${charge.tax_region}`
            });
            missingTaxRegions.add(cacheKey);
          }
          checkedTaxRegions.add(cacheKey);
        }
      }
    }

    if (isQuickBooks) {
      if (adapterType === 'quickbooks_online' && !batch.target_realm && lines.length > 0) {
        await repo.addError({
          batch_id: batchId,
          line_id: lines[0].line_id,
          code: 'missing_target_realm',
          message: 'QuickBooks exports require a target realm.'
        });
      }

      for (const invoice of invoices) {
        const clientRef = invoice.client_id ?? null;
        if (!clientRef) {
          const lineId = firstLineByInvoice.get(invoice.invoice_id);
          if (lineId && !missingClientRefs.has(invoice.invoice_id)) {
            await repo.addError({
              batch_id: batchId,
              line_id: lineId,
              code: 'missing_client_reference',
              message: `Invoice ${invoice.invoice_id} is missing a client association`
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
              if (lineId) {
                await repo.addError({
                  batch_id: batchId,
                  line_id: lineId,
                  code: 'missing_payment_term_mapping',
                  message: `No payment term mapping for ${client.payment_terms}`
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
    const service = await AccountingExportService.create();
    await service.updateExportBatchStatus(batchId, { status: cleanedStatus });
  }
}