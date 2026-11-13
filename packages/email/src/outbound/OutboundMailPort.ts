import type { OutboundMailClass } from '@alga-psa/types';

export interface OutboundMailMessage {
  tenantId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  mailClass: OutboundMailClass;
  boardId?: string;
  senderId?: string;
  userId?: string;
}

export type OutboundMailResult =
  | { status: 'sent'; messageId?: string }
  | { status: 'failed'; reason: string; retryable: boolean };

/** UI-free seam between rendered notifications and their configured transport. */
export interface OutboundMailPort {
  send(message: OutboundMailMessage): Promise<OutboundMailResult>;
}
