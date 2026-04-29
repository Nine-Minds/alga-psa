import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import {
  WorkflowRuntimeV2,
  workflowStepQuotaService,
} from '@alga-psa/workflows/runtime/core';
import {
  WorkflowRunLogModelV2,
} from '@alga-psa/workflows/persistence';

export interface WorkflowQuotaResumeScanJobData extends Record<string, unknown> {
  tenantId: string;
  batchSize?: number;
}

type QuotaWaitCandidate = {
  wait_id: string;
  run_id: string;
  step_path: string;
  tenant_id: string | null;
  engine: string | null;
};

const DEFAULT_BATCH_SIZE = 100;

function toFiniteCapacity(effectiveLimit: number | null, usedCount: number): number | null {
  if (effectiveLimit == null) return null;
  return Math.max(effectiveLimit - usedCount, 0);
}

export async function workflowQuotaResumeScanHandler(data: WorkflowQuotaResumeScanJobData): Promise<void> {
  const batchSize = Math.max(1, Math.min(Number(data.batchSize ?? DEFAULT_BATCH_SIZE), 500));
  const knex = await getAdminConnection();
  const runtime = new WorkflowRuntimeV2();
  const workerId = 'job:workflow-quota-resume-scan';

  let resumedTotal = 0;
  while (true) {
    const resumptions = await knex.transaction(async (trx) => {
      const nowIso = new Date().toISOString();
      const candidates = await trx<QuotaWaitCandidate>('workflow_run_waits as w')
        .join('workflow_runs as r', 'r.run_id', 'w.run_id')
        .where('w.wait_type', 'quota')
        .where('w.status', 'WAITING')
        .where('r.status', 'WAITING')
        .whereNotNull('r.tenant_id')
        .orderBy('w.created_at', 'asc')
        .forUpdate()
        .skipLocked()
        .limit(batchSize)
        .select('w.wait_id', 'w.run_id', 'w.step_path', 'r.tenant_id', 'r.engine');

      if (candidates.length === 0) {
        return [] as QuotaWaitCandidate[];
      }

      const selected: QuotaWaitCandidate[] = [];
      const byTenant = new Map<string, QuotaWaitCandidate[]>();
      for (const candidate of candidates) {
        if (!candidate.tenant_id) continue;
        const list = byTenant.get(candidate.tenant_id) ?? [];
        list.push(candidate);
        byTenant.set(candidate.tenant_id, list);
      }

      for (const [tenantId, waits] of byTenant.entries()) {
        const summary = await workflowStepQuotaService.resolveQuotaSummary(trx, tenantId);
        const capacity = toFiniteCapacity(summary.effectiveLimit, summary.usedCount);

        if (capacity === 0) {
          logger.debug('[WorkflowQuotaResumeScanJob] Skipping tenant with exhausted quota', {
            tenant: tenantId,
            periodStart: summary.periodStart,
            periodEnd: summary.periodEnd,
            effectiveLimit: summary.effectiveLimit,
            usedCount: summary.usedCount,
          });
          continue;
        }

        if (capacity == null) {
          selected.push(...waits);
          continue;
        }
        selected.push(...waits.slice(0, capacity));
      }

      if (selected.length === 0) return [];

      const selectedWaitIds = selected.map((entry) => entry.wait_id);
      const selectedRunIds = selected.map((entry) => entry.run_id);

      await trx('workflow_run_waits')
        .whereIn('wait_id', selectedWaitIds)
        .andWhere({ status: 'WAITING' })
        .update({
          status: 'RESOLVED',
          resolved_at: nowIso,
        });

      await trx('workflow_runs')
        .whereIn('run_id', selectedRunIds)
        .andWhere({ status: 'WAITING' })
        .update({
          status: 'RUNNING',
          resume_event_name: null,
          resume_event_payload: null,
          resume_error: null,
        });

      for (const selectedWait of selected) {
        await WorkflowRunLogModelV2.create(trx, {
          run_id: selectedWait.run_id,
          tenant_id: selectedWait.tenant_id,
          step_path: selectedWait.step_path,
          level: 'INFO',
          message: 'Quota wait resolved by scheduled scan',
          context_json: {
            waitId: selectedWait.wait_id,
            resumedBy: workerId,
          },
          source: 'worker',
        });
      }

      return selected;
    });

    if (resumptions.length === 0) break;
    resumedTotal += resumptions.length;

    for (const item of resumptions) {
      if (item.engine === 'temporal') {
        logger.info('[WorkflowQuotaResumeScanJob] Temporal quota wait resolved in projection; waiting for runtime re-entry path', {
          runId: item.run_id,
          waitId: item.wait_id,
        });
        continue;
      }
      await runtime.executeRun(knex, item.run_id, workerId);
    }
  }

  logger.info('[WorkflowQuotaResumeScanJob] Completed quota resume scan', {
    resumedRuns: resumedTotal,
    batchSize,
  });
}
