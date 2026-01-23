/**
 * Auth and analytics helpers for billing package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * billing -> auth -> ui -> analytics -> tenancy -> ... -> billing
 */

export async function getCurrentUserAsync() {
  const { getCurrentUser } = await import('@alga-psa/auth/getCurrentUser');
  return getCurrentUser();
}

export async function getSessionAsync() {
  const { getSession } = await import('@alga-psa/auth');
  return getSession();
}

export async function hasPermissionAsync(user: any, resource: string, action: string): Promise<boolean> {
  const { hasPermission } = await import('@alga-psa/auth');
  return hasPermission(user, resource, action);
}

// Analytics helpers
export async function getAnalyticsAsync() {
  const { analytics, AnalyticsEvents } = await import('@alga-psa/analytics');
  return { analytics, AnalyticsEvents };
}

export async function trackAnalyticsEventAsync(eventName: string, properties: Record<string, any>, userId?: string) {
  const { analytics } = await import('@alga-psa/analytics');
  analytics.capture(eventName, properties, userId);
}
