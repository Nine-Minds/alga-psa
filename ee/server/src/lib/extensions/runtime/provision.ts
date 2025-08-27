export { computeDomain } from '@alga-psa/shared/extensions/domain.js';

export async function enqueueProvisioningWorkflow(params: { tenantId: string; extensionId: string; installId?: string }) {
  // Best-effort Temporal client kickoff; falls back to no-op if client not available
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) return { enqueued: false };
    const address = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
    const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows';
    const conn = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection: conn, namespace });
    const workflowId = `provision-ext-domain:${params.tenantId}:${params.extensionId}`;
    await client.workflow.start('provisionExtensionDomain', {
      args: [params],
      taskQueue,
      workflowId,
    });
    return { enqueued: true };
  } catch (_e) {
    return { enqueued: false };
  }
}
