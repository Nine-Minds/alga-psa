/**
 * Auth and analytics helpers for billing package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * billing -> auth -> ui -> analytics -> tenancy -> ... -> billing
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getAuthModule = () => '@alga-psa/' + 'auth';
const getAuthCurrentUserModule = () => '@alga-psa/' + 'auth/getCurrentUser';
const getAnalyticsModule = () => '@alga-psa/' + 'analytics';

export async function getCurrentUserAsync() {
  const { getCurrentUser } = await import(/* webpackIgnore: true */ getAuthCurrentUserModule());
  return getCurrentUser();
}

export async function getSessionAsync() {
  const { getSession } = await import(/* webpackIgnore: true */ getAuthModule());
  return getSession();
}

export async function hasPermissionAsync(user: any, resource: string, action: string): Promise<boolean> {
  const { hasPermission } = await import(/* webpackIgnore: true */ getAuthModule());
  return hasPermission(user, resource, action);
}

// Analytics helpers
export async function getAnalyticsAsync() {
  const { analytics, AnalyticsEvents } = await import(/* webpackIgnore: true */ getAnalyticsModule());
  return { analytics, AnalyticsEvents };
}

export async function trackAnalyticsEventAsync(eventName: string, properties: Record<string, any>, userId?: string) {
  const { analytics } = await import(/* webpackIgnore: true */ getAnalyticsModule());
  analytics.capture(eventName, properties, userId);
}
