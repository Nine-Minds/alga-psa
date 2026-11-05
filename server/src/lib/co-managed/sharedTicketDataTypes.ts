import type { getCoManagedTicketScreen, CoManagedSharedResource, CoManagedTicketEditField, CoManagedTicketEditPatch } from '@alga-psa/co-managed';

/** Types only: safe to import from client code and from "use server" modules. */
export type CoManagedTicketScreen = Awaited<ReturnType<typeof getCoManagedTicketScreen>>;
export type SharedTicketOptionPage = { options: Array<{ id: string; name: string }>; nextAfterId: string | null };

type Option = { value: string; label: string };
/** The shape `TicketDetailsContainer` consumes, restricted to what a sponsor may see.
 * Undisclosed fields are absent from `ticket`; collections the shared model does
 * not support are empty. */
export interface SharedTicketData {
  ticket: {
    ticket_id: string; tenant: string;
    ticket_number?: unknown; title?: unknown; is_closed?: unknown; entered_at?: unknown; updated_at?: unknown; closed_at?: unknown;
    board_id?: string; status_id?: string; status_name?: string | null; priority_id?: string; priority_name?: string | null;
    url?: string | null; response_state?: 'awaiting_client' | 'awaiting_internal' | null; due_date?: string | null;
    /** Present only when the description is disclosed; the value is the BlockNote JSON string. */
    attributes?: { description: string | null };
    category_id?: string | null; client_name?: string | null; contact_name?: string | null;
    /** The customer's own assignee, disclosed by display name only (never its user ID). */
    assigned_to_name?: string | null;
  };
  comments: never[];
  documents: never[];
  client: { client_name: string } | null;
  contacts: never[];
  contactInfo: { full_name: string } | null;
  board: { board_id: string; board_name: string | null } | null;
  additionalAgents: never[];
  availableAgents: never[];
  userMap: Record<string, never>;
  contactMap: Record<string, never>;
  options: {
    status: Array<Option & { board_id: string | null }>;
    priority: Option[];
    board: Option[];
    agent: never[];
  };
  categories: Array<{ category_id: string; category_name: string | null; board_id: string | null }>;
  clients: never[];
  locations: never[];
  agentSchedules: never[];
}

export interface SharedTicketDetailsResult {
  resource: CoManagedSharedResource;
  ticketData: SharedTicketData;
  /** Read-only display of the customer's own assignee; present only when disclosed. */
  screen: {
    side: CoManagedTicketScreen['side']; canWrite: boolean; canEscalate: boolean; canHandBack: boolean; canRevoke: boolean;
    customerName: string; sponsorName: string | null; destinationName: string | undefined;
    revision: number;
    work_revision?: number; responsibility?: 'customer' | 'msp';
  };
  /** Per-field optimistic baselines for exactly the fields the caller may edit. */
  editor: { editableFields: CoManagedTicketEditField[]; baselines: CoManagedTicketEditPatch };
}
