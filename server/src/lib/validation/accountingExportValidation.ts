import { createTenantKnex } from '../db';
import { AccountingExportRepository } from '../repositories/accountingExportRepository';
import { AccountingExportService } from '../services/accountingExportService';

export class AccountingExportValidation {
  static async ensureMappingsForBatch(batchId: string): Promise<void> {
    const repo = await AccountingExportRepository.create();
    const batch = await repo.getBatch(batchId);
    if (!batch) {
      throw new Error(`Export batch ${batchId} not found`);
    }
    const lines = await repo.listLines(batchId);
    const knex = (await createTenantKnex()).knex;

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

      const mapping = await knex('tenant_external_entity_mappings')
        .where({
          integration_type: batch.adapter_type,
          alga_entity_type: 'service',
          alga_entity_id: line.invoice_charge_id
        })
        .first();

      if (!mapping) {
        await repo.addError({
          batch_id: batchId,
          line_id: line.line_id,
          code: 'missing_service_mapping',
          message: `No mapping for charge ${line.invoice_charge_id}`
        });
      }
    }

    const errors = await repo.listErrors(batchId);
    const cleanedStatus = errors.length === 0 ? 'ready' : 'needs_attention';
    const service = await AccountingExportService.create();
    await service.updateBatchStatus(batchId, { status: cleanedStatus });
  }
}
