/** Schedule only an already-reserved operation. Durable database progress is
 * authoritative even after Temporal history or provider deduplication expires. */
async function scheduleCoManagedProvisioningWorkflow(workflow: 'coManagedProvisioningWorkflow' | 'coManagedProvisioningCleanupWorkflow', input: {
  sponsorTenant: string; operationId: string;
}): Promise<{ enqueued: boolean }> {
  let connection: import('@temporalio/client').Connection | undefined;
  try {
    const mod = await import('@temporalio/client');
    connection = await mod.Connection.connect({ address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233' });
    const client = new mod.Client({ connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default' });
    await client.workflow.start(workflow, {
      args: [input], workflowId: `${workflow === 'coManagedProvisioningCleanupWorkflow' ? 'co-managed-provisioning-cleanup' : 'co-managed-provisioning'}:${input.sponsorTenant}:${input.operationId}`,
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      workflowExecutionTimeout: '1h', workflowTaskTimeout: '1m',
    });
    return { enqueued: true };
  } catch (error) {
    // With ALLOW_DUPLICATE a collision means the same operation is still running.
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') return { enqueued: true };
    return { enqueued: false };
  } finally {
    // We do not wait for the worker or expose its result (which may later gain
    // internal fields) to the sponsor's browser.
    await connection?.close().catch(() => undefined);
  }
}

export const startCoManagedProvisioningWorkflow = (input: { sponsorTenant: string; operationId: string }) =>
  scheduleCoManagedProvisioningWorkflow('coManagedProvisioningWorkflow', input);
export const startCoManagedProvisioningCleanupWorkflow = (input: { sponsorTenant: string; operationId: string }) =>
  scheduleCoManagedProvisioningWorkflow('coManagedProvisioningCleanupWorkflow', input);
