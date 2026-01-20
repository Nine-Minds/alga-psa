import { observabilityLogger } from '@/lib/observability/logging';

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
      observabilityLogger.error('Temporal client unavailable for managed email domain workflow', undefined, {
        event_type: 'managed_email_domain_workflow_enqueue_failed',
        tenant_id: params.tenantId,
        domain: params.domain,
        trigger: params.trigger,
      });
      return { enqueued: false, error: 'temporal_client_unavailable' };
    }

    let connection: any;
    try {
      connection = await temporalClient.Connection.connect({
        address: DEFAULT_TEMPORAL_ADDRESS,
      });
    } catch (error: any) {
      observabilityLogger.error('Failed to connect to Temporal for managed email domain workflow', error, {
        event_type: 'managed_email_domain_workflow_enqueue_failed',
        tenant_id: params.tenantId,
        domain: params.domain,
        trigger: params.trigger,
        temporal_address: DEFAULT_TEMPORAL_ADDRESS,
        temporal_namespace: DEFAULT_TEMPORAL_NAMESPACE,
      });
      return { enqueued: false, error: error?.message ?? 'temporal_connection_failed' };
    }

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
        observabilityLogger.error('Failed to start Temporal workflow for managed email domain', error, {
          event_type: 'managed_email_domain_workflow_enqueue_failed',
          tenant_id: params.tenantId,
          domain: params.domain,
          trigger: params.trigger,
          temporal_address: DEFAULT_TEMPORAL_ADDRESS,
          temporal_namespace: DEFAULT_TEMPORAL_NAMESPACE,
          task_queue: DEFAULT_TASK_QUEUE,
          workflow_name: WORKFLOW_NAME,
          workflow_id: workflowId,
        });
        return { enqueued: false, error: error?.message ?? 'unknown_error' };
      }

      try {
        const handle = client.workflow.getHandle(workflowId);
        await handle.signal(REFRESH_SIGNAL, params);
        return { enqueued: true, alreadyRunning: true };
      } catch (signalError: any) {
        observabilityLogger.error('Failed to signal existing Temporal workflow for managed email domain', signalError, {
          event_type: 'managed_email_domain_workflow_enqueue_failed',
          tenant_id: params.tenantId,
          domain: params.domain,
          trigger: params.trigger,
          temporal_address: DEFAULT_TEMPORAL_ADDRESS,
          temporal_namespace: DEFAULT_TEMPORAL_NAMESPACE,
          task_queue: DEFAULT_TASK_QUEUE,
          workflow_name: WORKFLOW_NAME,
          workflow_id: workflowId,
          signal_name: REFRESH_SIGNAL,
        });
        return { enqueued: false, error: signalError?.message ?? 'signal_failed' };
      }
    }
  } catch (error: any) {
    observabilityLogger.error('Unexpected error enqueueing managed email domain workflow', error, {
      event_type: 'managed_email_domain_workflow_enqueue_failed',
      tenant_id: params.tenantId,
      domain: params.domain,
      trigger: params.trigger,
    });
    return { enqueued: false, error: error?.message ?? 'unknown_error' };
  }
}
