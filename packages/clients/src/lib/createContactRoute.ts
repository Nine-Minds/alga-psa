// Shared contract for the app-wide create-contact modal route, the sibling of
// tickets' createTicketRoute: surfaces outside the workspace provider tree (the
// incoming-call card) navigate here instead of rendering QuickAddContact inline.

export const CREATE_CONTACT_PATH = '/msp/create-contact';

export interface CreateContactPrefill {
  clientId?: string;
  phone?: string;
}

type SearchParamValue = string | string[] | undefined;
type SearchParams = Record<string, SearchParamValue>;

const first = (value: SearchParamValue): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export function buildCreateContactHref(prefill: CreateContactPrefill = {}): string {
  const params = new URLSearchParams();
  if (prefill.clientId) params.set('clientId', prefill.clientId);
  if (prefill.phone) params.set('phone', prefill.phone);
  const qs = params.toString();
  return qs ? `${CREATE_CONTACT_PATH}?${qs}` : CREATE_CONTACT_PATH;
}

export function parseCreateContactPrefill(searchParams: SearchParams): CreateContactPrefill {
  return {
    clientId: first(searchParams.clientId) || undefined,
    phone: first(searchParams.phone) || undefined,
  };
}
