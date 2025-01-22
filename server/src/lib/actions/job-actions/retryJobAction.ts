import { getCurrentUser } from '../user-actions/userActions';
import { getJobDetails, scheduleImmediateJob } from '../../jobs';
import { auditLog } from '../../logging/auditLog';

export async function retryJobAction(jobId: string) {
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

    // Create new job with same data
    const newJobId = await scheduleImmediateJob(
      job.name,
      job.data
    );

    if (!newJobId) {
      throw new Error('Failed to retry job');
    }

    await auditLog({
      userId: user.user_id,
      tenantId: user.tenant,
      action: 'retry_job',
      details: { 
        originalJobId: jobId,
        newJobId
      }
    });

    return newJobId;
  } catch (error) {
    await auditLog({
      userId: user?.user_id,
      tenantId: user?.tenant,
      action: 'retry_job_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        jobId
      }
    });
    throw new Error('Failed to retry job');
  }
}