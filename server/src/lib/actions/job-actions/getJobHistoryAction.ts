import { getCurrentUser } from '../user-actions/userActions';
import { getJobHistory } from '../../jobs';
import { auditLog } from '../../logging/auditLog';
import type { JobHistoryFilter } from '../../jobs/index';

export async function getJobHistoryAction(filters: JobHistoryFilter) {
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('Unauthorized - No user session');
  }

  try {
    const history = await getJobHistory(user.tenant, {
      jobName: filters.jobName,
      startDate: filters.startDate,
      endDate: filters.endDate,
      status: filters.status,
      limit: filters.limit,
      offset: filters.offset
    });

    await auditLog({
      userId: user.user_id,
      tenantId: user.tenant,
      action: 'get_job_history',
      details: { filters }
    });

    return history;
  } catch (error) {
    await auditLog({
      userId: user?.user_id,
      tenantId: user?.tenant,
      action: 'get_job_history_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        filters
      }
    });
    throw new Error('Failed to get job history');
  }
}