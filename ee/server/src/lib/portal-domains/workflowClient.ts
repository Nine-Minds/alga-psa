export interface PortalDomainWorkflowParams {
  tenantId: string;
  portalDomainId: string;
  trigger?: 'register' | 'refresh' | 'disable';
}

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'portal-domain-workflows';
const WORKFLOW_NAME = 'portalDomainRegistrationWorkflow';
const RECONCILE_SIGNAL = 'reconcilePortalDomainState';

export async function enqueuePortalDomainWorkflow(
  params: PortalDomainWorkflowParams
): Promise<{ enqueued: boolean; signaled?: boolean }> {
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { enqueued: false };
    }

    const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
    const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
    const taskQueue = process.env.TEMPORAL_PORTAL_DOMAIN_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE;

    const connection = await mod.Connection.connect({ address });
    const client = new mod.Client({ connection, namespace });
    const workflowId = `portal-domain:${params.tenantId}`;

    try {
      await client.workflow.start(WORKFLOW_NAME, {
        args: [params],
        taskQueue,
        workflowId,
      });
      return { enqueued: true };
    } catch (error) {
      const alreadyStarted =
        (error && typeof error === 'object' && 'name' in error && (error as any).name === 'WorkflowExecutionAlreadyStartedError');

      if (!alreadyStarted) {
        throw error;
      }

      try {
        const handle = client.workflow.getHandle(workflowId);
        await handle.signal(RECONCILE_SIGNAL, params);
        return { enqueued: true, signaled: true };
      } catch (signalError) {
        return { enqueued: false };
      }
    }
  } catch (_err) {
    return { enqueued: false };
  }
}
