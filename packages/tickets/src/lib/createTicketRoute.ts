// Shared contract for the app-wide create-ticket modal route. Every surface that used
// to render <QuickAddTicket> inline now navigates to this route instead, so the rich-text
// editor (TextEditor, pulled in by QuickAddTicket) leaves those surfaces' first-load
// bundles and only loads when the create route mounts. Lives in the tickets package so
// callers in any package (and the server app route) can build/parse the same href.

export const CREATE_TICKET_PATH = '/msp/create-ticket';

export type CreateTicketCloseMode = 'back' | 'replace';

export interface CreateTicketPrefill {
  client?: { id: string; name: string };
  contact?: { id: string; name: string };
  assetId?: string;
  assetName?: string;
  title?: string;
  description?: string;
  assignedTo?: string;
  dueDate?: string;
  additionalAgents?: { user_id: string; name?: string }[];
  isAlgaDeskMode?: boolean;
}

type SearchParamValue = string | string[] | undefined;
type SearchParams = Record<string, SearchParamValue>;

const first = (value: SearchParamValue): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export function buildCreateTicketHref(prefill: CreateTicketPrefill = {}): string {
  const params = new URLSearchParams();
  if (prefill.client?.id) {
    params.set('clientId', prefill.client.id);
    if (prefill.client.name) params.set('clientName', prefill.client.name);
  }
  if (prefill.contact?.id) {
    params.set('contactId', prefill.contact.id);
    if (prefill.contact.name) params.set('contactName', prefill.contact.name);
  }
  if (prefill.assetId) params.set('assetId', prefill.assetId);
  if (prefill.assetName) params.set('assetName', prefill.assetName);
  if (prefill.title) params.set('title', prefill.title);
  if (prefill.description) params.set('description', prefill.description);
  if (prefill.assignedTo) params.set('assignedTo', prefill.assignedTo);
  if (prefill.dueDate) params.set('dueDate', prefill.dueDate);
  if (prefill.additionalAgents?.length) {
    params.set('agents', JSON.stringify(prefill.additionalAgents));
  }
  if (prefill.isAlgaDeskMode) params.set('form', 'algadesk');

  const qs = params.toString();
  return qs ? `${CREATE_TICKET_PATH}?${qs}` : CREATE_TICKET_PATH;
}

export function parseCreateTicketPrefill(searchParams: SearchParams): CreateTicketPrefill {
  const clientId = first(searchParams.clientId);
  const contactId = first(searchParams.contactId);

  let additionalAgents: CreateTicketPrefill['additionalAgents'];
  const agentsRaw = first(searchParams.agents);
  if (agentsRaw) {
    try {
      const parsed = JSON.parse(agentsRaw);
      if (Array.isArray(parsed)) additionalAgents = parsed;
    } catch {
      // ignore malformed agents param
    }
  }

  return {
    client: clientId ? { id: clientId, name: first(searchParams.clientName) ?? '' } : undefined,
    contact: contactId ? { id: contactId, name: first(searchParams.contactName) ?? '' } : undefined,
    assetId: first(searchParams.assetId),
    assetName: first(searchParams.assetName),
    title: first(searchParams.title),
    description: first(searchParams.description),
    assignedTo: first(searchParams.assignedTo),
    dueDate: first(searchParams.dueDate),
    additionalAgents,
    isAlgaDeskMode: first(searchParams.form) === 'algadesk',
  };
}
