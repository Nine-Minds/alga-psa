import { recoverCoManagedNotificationDeliveries } from '@alga-psa/notifications/lib/coManagedDeliveryRuntime';
export const CO_MANAGED_NOTIFICATION_RECOVERY_JOB = 'co-managed-notification-recovery';
export async function coManagedNotificationRecoveryHandler(input: { tenantId: string; limit?: number }) {
  return recoverCoManagedNotificationDeliveries(input.tenantId, input.limit);
}
