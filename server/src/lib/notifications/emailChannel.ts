// v6: Ticket update notifications now go through NotificationAccumulator for batching
export const EMAIL_EVENT_CHANNEL = 'emailservice::v6';

export function getEmailEventChannel(): string {
  return EMAIL_EVENT_CHANNEL;
}
