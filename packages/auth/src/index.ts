/**
 * @alga-psa/auth
 *
 * Authentication module for Alga PSA.
 * Provides session management, JWT encoding, and auth utilities.
 */

// Session utilities
export {
  getSessionMaxAge,
  getSessionCookieName,
  getSessionCookieConfig,
  getNextAuthSecret,
  getNextAuthSecretSync,
  encodePortalSessionToken,
  buildSessionCookie,
  clearCachedSecret
} from './lib/session';
export { getSession, getSessionWithRevocationCheck } from './lib/getSession';

// Type exports
export type { PortalSessionTokenPayload } from './lib/session';

// Permission utilities
export {
  hasPermission,
  checkMultiplePermissions
} from './lib/rbac';
export type { PermissionCheck, PermissionResult } from './lib/rbac';

export * from './lib/errors';

// API auth helpers
export {
  getAuthenticatedUser,
  requireAuthentication,
  checkPermission,
  requirePermission,
  createErrorResponse,
  createSuccessResponse
} from './lib/apiAuth';

// Device/session security helpers
export { getClientIp } from './lib/ipAddress';
export { generateDeviceFingerprint, getDeviceInfo } from './lib/deviceFingerprint';
export { getLocationFromIp } from './lib/geolocation';
export { isTwoFactorEnabled, verifyTwoFactorCode } from './lib/twoFactorHelpers';

// NextAuth config
export { getAuthOptions } from './lib/nextAuthOptions';

// Current user helper
export { getCurrentUser } from './lib/getCurrentUser';

// Server action wrappers (boundary-layer auth + tenant context)
export {
  withAuth,
  withOptionalAuth,
  withAuthCheck,
  AuthenticationError
} from './lib/withAuth';
export type { AuthContext, WithAuthOptions } from './lib/withAuth';

// UI components (used by Next.js route shims)
export { AppSessionProvider } from './components/AppSessionProvider';
export { default as Alert } from './components/Alert';
export { default as ClientLoginForm } from './components/ClientLoginForm';
export { default as ClientPortalSignIn } from './components/ClientPortalSignIn';
export { default as GeneralDialog } from './components/GeneralDialog';
export { default as MspLoginForm } from './components/MspLoginForm';
export { default as MspSignIn } from './components/MspSignIn';
export { default as PortalSessionHandoff } from './components/PortalSessionHandoff';
export { default as PortalSwitchPrompt } from './components/PortalSwitchPrompt';
export { default as RegisterForm } from './components/RegisterForm';
export { default as SignOutDialog } from './components/SignOutDialog';
export { default as TwoFactorInput } from './components/TwoFA';

// Services
export { PasswordResetService } from './services/PasswordResetService';
export { ApiKeyService } from './services/apiKeyService';

// Rate limiting
export * from './lib/security/rateLimiting';

// Server actions (Next.js / server-side entrypoints)
export * from './actions';
