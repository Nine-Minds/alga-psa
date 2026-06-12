/**
 * Community Edition stub. RMM alert reconciliation polling currently ships
 * with the Enterprise providers; the EE build aliases @enterprise to
 * ee/server/src where the real dispatcher lives.
 */

export async function registerRmmAlertReconciliation(_jobScheduler?: unknown): Promise<void> {
  // no-op in CE builds
}
