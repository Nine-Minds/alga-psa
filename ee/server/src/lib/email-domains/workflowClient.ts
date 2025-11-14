export interface ManagedEmailDomainWorkflowParams {
  tenantId: string;
  domain: string;
  region?: string;
  trigger?: 'register' | 'refresh' | 'delete';
  providerDomainId?: string;
}

const DEFAULT_TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'default';
const DEFAULT_TASK_QUEUE = process.env.EMAIL_DOMAIN_TASK_QUEUE || 'email-domain-workflows';
const WORKFLOW_NAME = 'managedEmailDomainWorkflow';
const REFRESH_SIGNAL = 'refreshManagedEmailDomain';

type EnqueueResult = {
  enqueued: boolean;
  alreadyRunning?: boolean;
  error?: string;
};

export async function enqueueManagedEmailDomainWorkflow(
  params: ManagedEmailDomainWorkflowParams
): Promise<EnqueueResult> {
  try {
    const temporalClient = await import('@temporalio/client').catch(() => null);
    if (!temporalClient) {
      return { enqueued: false, error: 'temporal_client_unavailable' };
    }

    const connection = await temporalClient.Connection.connect({
      address: DEFAULT_TEMPORAL_ADDRESS,
    });
    const client = new temporalClient.Client({
      connection,
      namespace: DEFAULT_TEMPORAL_NAMESPACE,
    });

    const workflowId = `managed-email-domain:${params.tenantId}:${params.domain}`;

    try {
      await client.workflow.start(WORKFLOW_NAME, {
        args: [params],
        taskQueue: DEFAULT_TASK_QUEUE,
        workflowId,
      });
      return { enqueued: true };
    } catch (error: any) {
      const alreadyStarted =
        error?.name === 'WorkflowExecutionAlreadyStartedError' ||
        error?.message?.includes('WorkflowExecutionAlreadyStartedError');

      if (!alreadyStarted) {
        return { enqueued: false, error: error?.message ?? 'unknown_error' };
      }

      try {
        const handle = client.workflow.getHandle(workflowId);
        await handle.signal(REFRESH_SIGNAL, params);
        return { enqueued: true, alreadyRunning: true };
      } catch (signalError: any) {
        return { enqueued: false, error: signalError?.message ?? 'signal_failed' };
      }
    }
  } catch (error: any) {
    return { enqueued: false, error: error?.message ?? 'unknown_error' };
  }
}
