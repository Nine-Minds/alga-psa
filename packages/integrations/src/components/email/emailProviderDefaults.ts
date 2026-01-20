import type { EmailProvider } from './types';

export const INBOUND_DEFAULTS_WARNING =
  'Inbound ticket defaults are required and emails won\'t process until one is selected.';

export function providerNeedsInboundDefaults(provider: Pick<EmailProvider, 'inboundTicketDefaultsId'>): boolean {
  return !provider.inboundTicketDefaultsId;
}
