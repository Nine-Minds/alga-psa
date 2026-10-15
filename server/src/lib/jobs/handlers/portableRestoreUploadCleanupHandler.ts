import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB } from '@alga-psa/jobs/handlers/portableRestoreUploadCleanupHandler';
export { PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB };

export function portableRestoreUploadCleanupJobHandler() {
  return runMaintenanceJob(PORTABLE_RESTORE_UPLOAD_CLEANUP_JOB);
}
