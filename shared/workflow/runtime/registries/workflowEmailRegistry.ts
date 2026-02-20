/**
 * Workflow Email Registry - Registration pattern for email functionality
 *
 * This decouples shared/workflow from @alga-psa/email to avoid a circular
 * dependency (shared → email → auth → ee-stubs → shared).
 *
 * App startup registers real email implementations via registerWorkflowEmailProvider().
 * Workflow actions use getWorkflowEmailProvider() at runtime.
 */

export interface WorkflowEmailProvider {
  TenantEmailService: {
    getInstance(tenantId: string): {
      sendEmail(params: unknown): Promise<{ success: boolean; error?: string }>;
    };
    getTenantEmailSettings(tenantId: string, trx: unknown): Promise<any>;
  };
  StaticTemplateProcessor: new (subject: string, html: string, text?: string) => {
    process(params: { templateData: Record<string, unknown> }): Promise<{ subject: string; html: string; text?: string }>;
  };
  EmailProviderManager: new () => {
    initialize(settings: unknown): Promise<void>;
    getAvailableProviders(tenantId: string): Promise<Array<{
      capabilities: {
        supportsAttachments?: boolean;
        maxAttachmentSize?: number;
        maxRecipientsPerMessage?: number;
      };
    }>>;
    sendEmail(params: unknown, tenantId: string): Promise<{
      success: boolean;
      error?: string;
      providerId?: string;
      providerType?: string;
      messageId?: string;
      sentAt?: string;
    }>;
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __algaWorkflowEmailProvider: WorkflowEmailProvider | null | undefined;
}

/**
 * Register email provider implementations (called at app startup)
 */
export function registerWorkflowEmailProvider(impl: WorkflowEmailProvider): void {
  globalThis.__algaWorkflowEmailProvider = impl;
}

/**
 * Get the current email provider (used by workflow actions)
 */
export function getWorkflowEmailProvider(): WorkflowEmailProvider {
  if (!globalThis.__algaWorkflowEmailProvider) {
    throw new Error('Workflow email provider not registered. Ensure registerWorkflowEmailProvider() is called at app startup.');
  }
  return globalThis.__algaWorkflowEmailProvider;
}

/**
 * Reset to default (for testing)
 */
export function resetWorkflowEmailProvider(): void {
  globalThis.__algaWorkflowEmailProvider = null;
}
