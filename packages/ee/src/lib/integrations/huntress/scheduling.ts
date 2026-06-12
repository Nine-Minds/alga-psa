/**
 * Community Edition stub. The Huntress integration is an Enterprise feature;
 * the EE build aliases @enterprise to ee/server/src where the real
 * implementation lives.
 */

export async function registerHuntressPolling(_jobScheduler?: unknown): Promise<void> {
  // no-op in CE builds
}
