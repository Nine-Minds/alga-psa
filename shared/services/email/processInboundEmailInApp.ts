import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';

export interface ProcessInboundEmailInAppInput {
  tenantId: string;
  providerId: string;
  emailData: EmailMessageDetails;
}

export type ProcessInboundEmailInAppResult =
  | {
      outcome: 'skipped';
      reason: 'missing_defaults' | 'invalid_email_data';
    }
  | {
      outcome: 'deduped';
      dedupeKey: string;
      ticketId?: string;
      commentId?: string;
    }
  | {
      outcome: 'replied';
      matchedBy: 'reply_token' | 'thread_headers';
      ticketId: string;
      commentId: string;
    }
  | {
      outcome: 'created';
      ticketId: string;
      ticketNumber?: string;
      commentId: string;
    };

