/**
 * Email Provider Registry - Registration pattern for email functionality
 *
 * This allows the app to register email implementations without creating
 * a circular dependency (auth importing from email).
 *
 * Default stubs throw "email not configured" errors.
 * App startup registers real implementations.
 *
 * Uses globalThis to ensure the registry is a true process-wide singleton,
 * surviving Next.js webpack chunk boundaries that can create separate
 * module instances for instrumentation vs server action contexts.
 */

export interface AuthEmailProvider {
  sendPasswordResetEmail(params: {
    email: string;
    userName: string;
    resetLink: string;
    expirationTime: string;
    tenant: string;
    supportEmail: string;
    clientName: string;
  }): Promise<boolean>;

  /**
   * True when the environment-backed system email provider is configured and
   * not disabled (resolved by @alga-psa/email's resolveSystemEmailState).
   */
  isSystemEmailConfigured(): boolean;

  getSystemEmailService(): Promise<{
    isConfigured(): Promise<boolean>;
    sendEmailVerification(params: {
      email: string;
      verificationUrl: string;
      clientName: string;
      expirationTime: string;
    }): Promise<{ success: boolean; error?: string }>;
  }>;

  getTenantEmailService(tenant: string): Promise<{
    isConfigured(): Promise<boolean>;
  }>;
}

const defaultRegistry: AuthEmailProvider = {
  sendPasswordResetEmail: async () => {
    throw new Error('Email provider not configured: sendPasswordResetEmail not registered');
  },

  isSystemEmailConfigured: () => {
    throw new Error('Email provider not configured: isSystemEmailConfigured not registered');
  },

  getSystemEmailService: async () => {
    throw new Error('Email provider not configured: getSystemEmailService not registered');
  },

  getTenantEmailService: async () => {
    throw new Error('Email provider not configured: getTenantEmailService not registered');
  },
};

declare global {
  // eslint-disable-next-line no-var
  var __algaAuthEmailRegistry: AuthEmailProvider | undefined;
}

function getOrCreateRegistry(): AuthEmailProvider {
  if (!globalThis.__algaAuthEmailRegistry) {
    globalThis.__algaAuthEmailRegistry = { ...defaultRegistry };
  }
  return globalThis.__algaAuthEmailRegistry;
}

/**
 * Register email provider implementations (called at app startup).
 * isSystemEmailConfigured is required so the compiler flags any registration
 * that would leave registerUser hitting the throwing default.
 */
export type AuthEmailProviderRegistration = Partial<AuthEmailProvider> &
  Pick<AuthEmailProvider, 'isSystemEmailConfigured'>;

export function registerAuthEmailProvider(impl: AuthEmailProviderRegistration): void {
  const current = getOrCreateRegistry();
  globalThis.__algaAuthEmailRegistry = { ...current, ...impl };
}

/**
 * Get the current email registry (used by auth code)
 */
export function getAuthEmailRegistry(): AuthEmailProvider {
  return getOrCreateRegistry();
}

/**
 * Reset to default registry (for testing)
 */
export function resetAuthEmailRegistry(): void {
  globalThis.__algaAuthEmailRegistry = { ...defaultRegistry };
}
