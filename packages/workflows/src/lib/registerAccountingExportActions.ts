'use server';

import { getActionRegistry, type ActionParameterDefinition } from '@alga-psa/shared/workflow/core/actionRegistry';
import { logger } from '@alga-psa/core';

let accountingActionsRegistered = false;

export async function registerAccountingExportWorkflowActions(): Promise<void> {
  if (accountingActionsRegistered) {
    return;
  }

  const registry = getActionRegistry();

  const createParameters: ActionParameterDefinition[] = [
    { name: 'adapterType', type: 'string', required: true },
    { name: 'targetRealm', type: 'string', required: false },
    { name: 'startDate', type: 'string', required: false },
    { name: 'endDate', type: 'string', required: false },
    { name: 'invoiceStatuses', type: 'string', required: false },
    { name: 'notes', type: 'string', required: false }
  ];

  registry.registerSimpleAction(
    'accounting_export.create_batch',
    'Create an accounting export batch',
    createParameters,
    async (params) => {
      try {
        const { createAccountingExportBatch } = await import('@alga-psa/billing/actions');
        const filters: Record<string, unknown> = {};

        if (params.startDate) {
          filters.start_date = params.startDate;
        }
        if (params.endDate) {
          filters.end_date = params.endDate;
        }
        if (params.invoiceStatuses) {
          const statuses = Array.isArray(params.invoiceStatuses)
            ? params.invoiceStatuses
            : String(params.invoiceStatuses)
                .split(',')
                .map((status) => status.trim())
                .filter(Boolean);
          if (statuses.length > 0) {
            filters.invoice_statuses = statuses;
          }
        }

        const batch = await createAccountingExportBatch({
          adapter_type: params.adapterType,
          export_type: 'invoice',
          target_realm: params.targetRealm || null,
          filters: Object.keys(filters).length > 0 ? filters : null,
          notes: params.notes || null
        });

        return {
          success: true,
          batch
        };
      } catch (error) {
        logger.error('[Workflow] Failed to create accounting export batch', { error, params });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error creating export batch'
        };
      }
    }
  );

  const executeParameters: ActionParameterDefinition[] = [
    { name: 'batchId', type: 'string', required: true }
  ];

  registry.registerSimpleAction(
    'accounting_export.execute_batch',
    'Execute an accounting export batch',
    executeParameters,
    async (params) => {
      try {
        const { executeAccountingExportBatch } = await import('@alga-psa/billing/actions');
        const result = await executeAccountingExportBatch(params.batchId);
        return {
          success: true,
          delivery: result
        };
      } catch (error) {
        logger.error('[Workflow] Failed to execute accounting export batch', { error, params });
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error executing export batch'
        };
      }
    }
  );

  accountingActionsRegistered = true;
  logger.info('[Workflow] Registered accounting export workflow actions');
}
