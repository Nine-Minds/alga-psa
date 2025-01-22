import { getCurrentUser } from '../user-actions/userActions';
import { getJobDetails } from '../../jobs';
import { auditLog } from '../../logging/auditLog';

export async function getJobDetailsAction(jobId: string) {
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

    await auditLog({
      userId: user.user_id,
      tenantId: user.tenant,
      action: 'get_job_details',
      details: { jobId }
    });

    return job;
  } catch (error) {
    await auditLog({
      userId: user?.user_id,
      tenantId: user?.tenant,
      action: 'get_job_details_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        jobId
      }
    });
    throw new Error('Failed to get job details');
  }
}