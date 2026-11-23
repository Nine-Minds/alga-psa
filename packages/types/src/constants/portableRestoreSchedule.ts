/** Shared schedule identity for server and Temporal scheduler processes. */
export const PORTABLE_RESTORE_UPLOAD_CLEANUP_SCHEDULE = Object.freeze({
  jobName: 'portable-restore-upload-cleanup',
  cron: '*/15 * * * *',
});
