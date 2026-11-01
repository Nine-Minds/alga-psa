import {
  buildTicketListHref,
  isQualifiedTicketListScope,
  parseTicketListPresentation,
  parseTicketListScope,
} from '@alga-psa/tickets/lib';

export const DEFAULT_CUSTOMER_TICKETS_HREF = '/msp/tickets/customer?queueView=working&workspace=all';

/** Return context describes presentation only; queue reads still authorize every row. */
export function coManagedTicketReturnHref(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return DEFAULT_CUSTOMER_TICKETS_HREF;
  try {
    const url = new URL(value, 'https://ticket-list.invalid');
    if (url.origin !== 'https://ticket-list.invalid' || url.pathname !== '/msp/tickets/customer') {
      return DEFAULT_CUSTOMER_TICKETS_HREF;
    }
    const scope = parseTicketListScope(url.searchParams);
    if (!isQualifiedTicketListScope(scope)) return DEFAULT_CUSTOMER_TICKETS_HREF;
    const presentation = parseTicketListPresentation(url.searchParams);
    return buildTicketListHref(scope, presentation, { includeClient: Boolean(presentation.clientId) });
  } catch {
    return DEFAULT_CUSTOMER_TICKETS_HREF;
  }
}
