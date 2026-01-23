// v7: bump the channel namespace to reflect email notification pipeline changes.
export const EMAIL_EVENT_CHANNEL = 'emailservice::v7';

export function getEmailEventChannel(): string {
  return EMAIL_EVENT_CHANNEL;
}
