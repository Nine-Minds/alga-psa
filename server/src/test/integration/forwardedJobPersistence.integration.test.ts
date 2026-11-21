import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { JobService } from '../../services/job.service';
import { JobStatus } from '../../types/job';
import { InvoiceZipJobHandler } from '../../lib/jobs/handlers/invoiceZipHandler';
import type { StorageService } from '@alga-psa/storage/StorageService';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

describe('forwarded job persistence', () => {
  let db: Knex;
  const jobService = new JobService({} as any);
  const tenant = uuidv4();

  function tenantTable(table: string) {
    return tenantDb(db, tenant).table(table);
  }

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    await tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'forwarded job persistence fixture')
      .insert({ tenant, client_name: `Forwarded Job ${tenant.slice(0, 8)}`, email: `${tenant}@example.com` });
  });

  afterAll(async () => {
    if (db) {
      await tenantTable('job_details').where({ tenant }).del();
      await tenantTable('jobs').where({ tenant }).del();
      await tenantDb(db, '__test_tenant_fixture__')
        .unscoped('tenants', 'forwarded job persistence cleanup')
        .where({ tenant }).del();
      await db.destroy();
    }
  });

  async function insertJob(metadata: Record<string, unknown>, status: JobStatus): Promise<string> {
    const jobId = uuidv4();
    await tenantTable('jobs').insert({
      tenant,
      job_id: jobId,
      type: 'invoice_email',
      status,
      metadata: JSON.stringify(metadata),
      created_at: new Date(),
      updated_at: new Date(),
    });
    return jobId;
  }

  async function getJob(jobId: string) {
    return tenantTable('jobs').where({ job_id: jobId }).first('status', 'metadata');
  }

  it('preserves a workflow timeout when a late handler writes progress and completion', async () => {
    const executionId = uuidv4();
    const jobId = await insertJob({
      serverExecution: { executionId, status: 'failed', error: 'delivery outcome is unknown' },
      stepResults: [],
    }, JobStatus.Failed);

    await jobService.updateJobStatus(jobId, JobStatus.Processing, {
      tenantId: tenant,
      forwardedExecutionId: executionId,
      stepResult: { step: 'invoice_email', status: 'started', details: 'late progress' },
    });
    let persisted = await getJob(jobId);
    let metadata = typeof persisted.metadata === 'string' ? JSON.parse(persisted.metadata) : persisted.metadata;
    expect(persisted.status).toBe(JobStatus.Failed);
    expect(metadata.serverExecution).toEqual({ executionId, status: 'failed', error: 'delivery outcome is unknown' });

    await jobService.updateJobStatus(jobId, JobStatus.Completed, {
      tenantId: tenant,
      forwardedExecutionId: executionId,
      details: 'late handler completion',
    });

    persisted = await getJob(jobId);
    metadata = typeof persisted.metadata === 'string' ? JSON.parse(persisted.metadata) : persisted.metadata;
    expect(persisted.status).toBe(JobStatus.Failed);
    expect(metadata.serverExecution).toEqual({ executionId, status: 'failed', error: 'delivery outcome is unknown' });
    expect(metadata.stepResults).toEqual([
      { step: 'invoice_email', status: 'started', details: 'late progress' },
    ]);
  });

  it('keeps a ZIP handler progress write from replacing a forwarded workflow failure', async () => {
    const executionId = uuidv4();
    const jobId = await insertJob({
      serverExecution: { executionId, status: 'failed', error: 'ZIP delivery outcome is unknown' },
      stepResults: [],
    }, JobStatus.Failed);
    const handler = new InvoiceZipJobHandler(jobService, {} as StorageService);
    // Stop after the handler has emitted its real progress update. This leaves
    // PDF/storage generation outside this persistence regression while the
    // handler and JobService status path both execute for real.
    (handler as any).processSingleInvoice = async () => {
      const persisted = await getJob(jobId);
      const metadata = typeof persisted.metadata === 'string' ? JSON.parse(persisted.metadata) : persisted.metadata;
      expect(persisted.status).toBe(JobStatus.Failed);
      expect(metadata.serverExecution).toEqual({ executionId, status: 'failed', error: 'ZIP delivery outcome is unknown' });
      throw new Error('stop after progress assertion');
    };
    await expect((handler as any).executeInvoiceZipJob(jobId, {
      jobServiceId: jobId,
      forwardedExecutionId: executionId,
      tenantId: tenant,
      requesterId: uuidv4(),
      invoiceIds: [uuidv4()],
      steps: [{ stepName: 'Generate invoice', type: 'invoice', metadata: { tenantId: tenant } }],
      metadata: { user_id: uuidv4(), invoice_count: 1, tenantId: tenant },
    })).rejects.toThrow('stop after progress assertion');
  });

  it('merges interleaved handler progress with a persisted execution outcome', async () => {
    const executionId = uuidv4();
    const jobId = await insertJob({
      serverExecution: { executionId, status: 'processing' },
      stepResults: [],
    }, JobStatus.Processing);

    await Promise.all([
      jobService.updateJobStatus(jobId, JobStatus.Processing, {
        tenantId: tenant,
        forwardedExecutionId: executionId,
        stepResult: { step: 'invoice_email', status: 'completed', details: 'PDF emailed' },
      }),
      jobService.recordForwardedJobOutcome(jobId, tenant, executionId, { status: 'completed' }),
    ]);

    const persisted = await getJob(jobId);
    const metadata = typeof persisted.metadata === 'string' ? JSON.parse(persisted.metadata) : persisted.metadata;
    expect(metadata.serverExecution).toMatchObject({ executionId, status: 'completed' });
    expect(metadata.stepResults).toEqual([
      { step: 'invoice_email', status: 'completed', details: 'PDF emailed' },
    ]);
    // Handler progress is not allowed to claim terminal job status; the
    // workflow's status transition remains authoritative.
    expect(persisted.status).toBe(JobStatus.Processing);
  });

  it('retains normal status transitions for non-forwarded jobs', async () => {
    const jobId = await insertJob({ stepResults: [] }, JobStatus.Queued);
    await jobService.updateJobStatus(jobId, JobStatus.Completed, {
      tenantId: tenant,
      details: 'ordinary job completed',
    });
    expect((await getJob(jobId)).status).toBe(JobStatus.Completed);
  });
});
