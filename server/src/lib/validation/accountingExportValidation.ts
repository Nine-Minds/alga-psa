import { createTenantKnex } from '../db';
import { AccountingExportRepository } from '../repositories/accountingExportRepository';
import { AccountingExportService } from '../services/accountingExportService';
import { AccountingMappingResolver } from '../services/accountingMappingResolver';

export class AccountingExportValidation {
  static async ensureMappingsForBatch(batchId: string): Promise<void> {
    const repo = await AccountingExportRepository.create();
    const batch = await repo.getBatch(batchId);
    if (!batch) {
      throw new Error(`Export batch ${batchId} not found`);
    }
    const lines = await repo.listLines(batchId);
    const knex = (await createTenantKnex()).knex;
    const resolver = await AccountingMappingResolver.create();

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

      const charge = await knex('invoice_charges')
        .select('service_id')
        .where({ tenant: batch.tenant, item_id: line.invoice_charge_id })
        .first();

      if (!charge?.service_id) {
        await repo.addError({
          batch_id: batchId,
          line_id: line.line_id,
          code: 'missing_service',
          message: `Charge ${line.invoice_charge_id} missing associated service`
        });
        continue;
      }

      const mapping = await resolver.resolveServiceMapping({
        adapterType: batch.adapter_type,
        targetRealm: batch.target_realm,
        serviceId: charge.service_id
      });

      if (!mapping) {
        await repo.addError({
          batch_id: batchId,
          line_id: line.line_id,
          code: 'missing_service_mapping',
          message: `No mapping for service ${charge.service_id}`
        });
      }
    }

    const errors = await repo.listErrors(batchId);
    const cleanedStatus = errors.length === 0 ? 'ready' : 'needs_attention';
    const service = await AccountingExportService.create();
    await service.updateBatchStatus(batchId, { status: cleanedStatus });
  }
}
