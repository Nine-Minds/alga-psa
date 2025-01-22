import { getCurrentUser } from '../user-actions/userActions';
import { getJobDetails, cancelScheduledJob } from '../../jobs';
import { auditLog } from '../../logging/auditLog';

export async function cancelJobAction(jobId: string) {
  const user = await getCurrentUser();
  
  if (!user) {
    throw new Error('Unauthorized - No user session');
  }

  try {
    const job = await getJobDetails(jobId);

    if (!job) {
      throw new Error('Job not found');
    }

    // Verify tenant access
    if (job.data.tenant !== user.tenant) {
      throw new Error('Unauthorized job access');
    }

    const success = await cancelScheduledJob(jobId);

    await auditLog({
      userId: user.user_id,
      tenantId: user.tenant,
      action: 'cancel_job',
      details: { jobId, success }
    });

    return success;
  } catch (error) {
    await auditLog({
      userId: user?.user_id,
      tenantId: user?.tenant,
      action: 'cancel_job_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        jobId
      }
    });
    throw new Error('Failed to cancel job');
  }
}