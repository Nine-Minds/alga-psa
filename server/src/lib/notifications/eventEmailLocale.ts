import type { SupportedLocale } from '@alga-psa/core/i18n/config';
import {
  getUserInfoForEmail,
  resolveEmailLocale,
} from '@alga-psa/notifications/notifications/emailLocaleResolver';
import type { SendEmailParams } from './sendEventEmail';

type EmailLocaleParams = Pick<
  SendEmailParams,
  'tenantId' | 'to' | 'locale' | 'recipientUserId' | 'recipientClientId'
>;

export async function resolveEventEmailLocale(params: EmailLocaleParams): Promise<SupportedLocale> {
  if (params.locale) {
    return params.locale;
  }

  const recipient = params.recipientUserId
    ? { email: params.to, userId: params.recipientUserId }
    : await getUserInfoForEmail(params.tenantId, params.to) || { email: params.to };

  return resolveEmailLocale(params.tenantId, {
    ...recipient,
    ...(params.recipientClientId && { clientId: params.recipientClientId }),
  });
}
