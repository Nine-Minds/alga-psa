import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB } from '@alga-psa/jobs/handlers/portableRestoreUploadCleanupHandler';
export { PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB };

export function portableRestoreUploadCleanupJobHandler() {
  return runMaintenanceJob(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB);
}


export async function schedulePortableRestoreUploadCleanupJob(cronExpression = '*/15 * * * *'): Promise<string | null> {
  if (process.env.EDITION === 'enterprise' || process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise') return null;
  const { initializeScheduler } = await import('../index');
  const scheduler = await initializeScheduler();
  return scheduler.scheduleRecurringJob(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB, cronExpression, {});
}
