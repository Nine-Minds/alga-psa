/**
 * Stub for @alga-psa/notifications/notifications/email
 *
 * At runtime inside the temporal worker container, the real
 * @alga-psa/notifications package is available under packages/.
 * This stub satisfies TypeScript compilation in the Docker build
 * where the full notification package's transitive UI deps
 * (next-themes, etc.) are not installed.
 */

export class EmailNotificationService {
  async sendNotification(_params: {
    tenant: string;
    userId: string;
    subtypeId: number | string;
    emailAddress: string;
    templateName: string;
    data: Record<string, string | number | boolean>;
  }): Promise<void> {
    throw new Error('EmailNotificationService stub — should not be called in temporal worker');
  }
}

let instance: EmailNotificationService | null = null;

export function getEmailNotificationService(): EmailNotificationService {
  if (!instance) {
    instance = new EmailNotificationService();
  }
  return instance;
}
