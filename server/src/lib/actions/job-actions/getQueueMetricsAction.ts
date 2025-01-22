import { getCurrentUser } from '../user-actions/userActions';
import { getQueueStatus } from '../../jobs';
import { auditLog } from '../../logging/auditLog';

export async function getQueueMetricsAction() {
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('Unauthorized - No user session');
  }

  try {
    const metrics = await getQueueStatus();

    await auditLog({
      userId: user.user_id,
      tenantId: user.tenant,
      action: 'get_queue_metrics',
      details: { metrics }
    });

    return metrics;
  } catch (error) {
    await auditLog({
      userId: user?.user_id,
      tenantId: user?.tenant,
      action: 'get_queue_metrics_error',
      details: { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    });
    throw new Error('Failed to get queue metrics');
  }
}