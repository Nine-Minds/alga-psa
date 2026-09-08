'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { PublishedConversationEmail, ReviewedEmailAddress } from '@alga-psa/shared/lib/email/reviewedEmail';

export const emailDeliveryLabels = {
  received: 'Email received.',
  delivered: 'Email sent.',
  scheduled: 'Email scheduled. It has not been published or sent.',
  canceled: 'Scheduled email canceled.',
  pending: 'Send accepted. Delivery has not started.',
  sending: 'Delivery is in progress. Check this send for its result.',
  unknown: 'Delivery could not be confirmed. Check the mailbox before sending this message again.',
  blocked: 'Email was not sent. The sender or delivery settings need attention.',
  reviewed: '',
};
export const emailAddressLabel = (value: ReviewedEmailAddress) => value.name ? `${value.name} <${value.email}>` : value.email;

export function ConversationEmailEnvelope({ email }: { email: PublishedConversationEmail }) {
  const { t } = useTranslation('features/tickets');
  return <div className="mb-3 space-y-2 border-b border-[rgb(var(--color-border-200))] pb-3 text-xs text-muted-foreground">
    <p className="font-medium text-[rgb(var(--color-text-700))]">{email.subject}</p>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words">
      <dt>{t('namedConversations.from', 'From')}</dt><dd>{emailAddressLabel(email.from)}</dd>
      <dt>{t('namedConversations.to', 'To')}</dt><dd>{email.to.map(emailAddressLabel).join('; ')}</dd>
      {email.cc.length > 0 && <><dt>{t('namedConversations.cc', 'CC')}</dt><dd>{email.cc.map(emailAddressLabel).join('; ')}</dd></>}
    </dl>
    <p>{t(`namedConversations.delivery.${email.delivery}`, emailDeliveryLabels[email.delivery])}</p>
  </div>;
}
