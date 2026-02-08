/**
 * Email Provider Registry - Registration pattern for email functionality
 *
 * This allows the app to register email implementations without creating
 * a circular dependency (auth importing from email).
 *
 * Default stubs throw "email not configured" errors.
 * App startup registers real implementations.
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

  getSystemEmailService: async () => {
    throw new Error('Email provider not configured: getSystemEmailService not registered');
  },

  getTenantEmailService: async () => {
    throw new Error('Email provider not configured: getTenantEmailService not registered');
  },
};

let registry: AuthEmailProvider = { ...defaultRegistry };

/**
 * Register email provider implementations (called at app startup)
 */
export function registerAuthEmailProvider(impl: Partial<AuthEmailProvider>): void {
  registry = { ...registry, ...impl };
}

/**
 * Get the current email registry (used by auth code)
 */
export function getAuthEmailRegistry(): AuthEmailProvider {
  return registry;
}

/**
 * Reset to default registry (for testing)
 */
export function resetAuthEmailRegistry(): void {
  registry = { ...defaultRegistry };
}
