import { TenantEmailService } from '../TenantEmailService';
import { StaticTemplateProcessor } from '../templateProcessors';
import type { OutboundMailPort, OutboundMailMessage, OutboundMailResult } from './OutboundMailPort';

/** Routes rendered mail through the tenant provider selection, including board sender routing. */
export class TenantEmailOutboundAdapter implements OutboundMailPort {
  constructor(private readonly resolveService = TenantEmailService.getInstance) {}

  async send(message: OutboundMailMessage): Promise<OutboundMailResult> {
    try {
      const result = await this.resolveService(message.tenantId).sendEmail({
        tenantId: message.tenantId,
        to: message.to,
        mailClass: message.mailClass,
        boardId: message.boardId,
        senderId: message.senderId,
        userId: message.userId,
        templateProcessor: new StaticTemplateProcessor(message.subject, message.html, message.text),
      });
      return result.success
        ? { status: 'sent', messageId: result.messageId }
        : {
            status: 'failed',
            reason: result.error || 'Email provider failed to send',
            retryable: typeof result.metadata?.retryable === 'boolean' ? result.metadata.retryable : false,
          };
    } catch (error) {
      const retryable = error && typeof error === 'object' && 'isRetryable' in error
        ? Boolean((error as { isRetryable?: unknown }).isRetryable)
        : false;
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        retryable,
      };
    }
  }
}
