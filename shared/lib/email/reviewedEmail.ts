export interface ReviewedEmailAddress { email: string; name?: string }
export type ConversationEmailDeliveryState = 'pending' | 'sending' | 'delivered' | 'unknown' | 'blocked';
export interface PublishedConversationEmail {
  from: ReviewedEmailAddress;
  replyTo?: ReviewedEmailAddress;
  to: ReviewedEmailAddress[];
  cc: ReviewedEmailAddress[];
  subject: string;
  delivery: ConversationEmailDeliveryState;
}

/** A server-produced review is a consistency check, not mailbox authorization.
 * The conversation command must retain current sender and destination authority. */
export interface ReviewedEmailIntent {
  senderRevision: string;
  messageHash: string;
}
export interface ReviewedEmailPreview extends ReviewedEmailIntent {
  providerId: string;
  providerType: string;
  from: ReviewedEmailAddress;
  replyTo?: ReviewedEmailAddress;
  to: ReviewedEmailAddress[];
  cc: ReviewedEmailAddress[];
  subject: string;
  html: string;
  text: string;
  files: Array<{ filename: string; contentType?: string; size: number }>;
}
