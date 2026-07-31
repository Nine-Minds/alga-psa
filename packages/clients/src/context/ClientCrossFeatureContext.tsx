'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ITicket, ITicketCategory, IBoard, IUser, ITag, ISlaPolicy, SurveyClientSatisfactionSummary, IOnlineMeeting } from '@alga-psa/types';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export interface QuickAddTicketRenderProps {
  id?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded: (ticket: ITicket) => void;
  prefilledClient?: { id: string; name: string };
  prefilledContact?: { id: string; name: string };
  prefilledDescription?: string;
}

export interface TicketFormOptions {
  statusOptions: any[];
  priorityOptions: any[];
  boardOptions: any[];
  categories: any[];
  tags: any[];
  users: any[];
}

export interface SurveySummaryRenderProps {
  summary: SurveyClientSatisfactionSummary | null;
}

export interface ClientAssetsRenderProps {
  clientId: string;
}

export interface ClientOpportunitiesRenderProps {
  clientId: string;
  clientName: string;
}

export interface ClientTicketsRenderProps {
  clientId: string;
  clientName?: string;
  initialBoards?: IBoard[];
  initialStatuses?: any[];
  initialPriorities?: any[];
  initialCategories?: ITicketCategory[];
  initialTags?: ITag[];
  initialUsers?: IUser[];
}

export interface ContactTicketsRenderProps {
  contactId: string;
  contactName?: string;
  clientId?: string;
  clientName?: string;
  initialBoards?: IBoard[];
  initialStatuses?: any[];
  initialPriorities?: any[];
  initialCategories?: ITicketCategory[];
  initialTags?: ITag[];
  initialUsers?: IUser[];
}

export interface ContractWizardRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  clientId: string;
}

export interface ContractQuickAddRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  clientId: string;
}

export interface TeamsMeetingCapability {
  available: boolean;
  reason?: string;
  recordingsAvailable?: boolean;
  recordingReason?: string;
}

export interface ScheduleTeamsMeetingFromClientInput {
  subject: string;
  startDateTime: string | Date;
  endDateTime: string | Date;
  client_id?: string | null;
  contact_name_id?: string | null;
  attendees?: Array<{ emailAddress: string; name?: string }>;
}

export interface ScheduleTeamsMeetingFromClientResult {
  success: boolean;
  data?: {
    interaction_id: string;
    meeting_id: string;
    schedule_entry_id: string | null;
    join_url: string;
  };
  error?: string;
}

export interface ClientCrossFeatureCallbacks {
  renderQuickAddTicket: (props: QuickAddTicketRenderProps) => ReactNode;
  getTicketFormOptions: () => Promise<TicketFormOptions>;
  renderSurveySummaryCard: (props: SurveySummaryRenderProps) => ReactNode;
  renderClientAssets: (props: ClientAssetsRenderProps) => ReactNode;
  /** Optional: the Opportunities tab on client detail (provided by the composition layer when the module is available). */
  renderClientOpportunities?: (props: ClientOpportunitiesRenderProps) => ReactNode;
  renderClientTickets: (props: ClientTicketsRenderProps) => ReactNode;
  renderContactTickets: (props: ContactTicketsRenderProps) => ReactNode;
  renderContractWizard?: (props: ContractWizardRenderProps) => ReactNode;
  renderContractQuickAdd?: (props: ContractQuickAddRenderProps) => ReactNode;
  /** Open a ticket in the shared drawer, keeping the current page underneath. */
  openTicketDetails?: (ticketId: string) => Promise<void>;
  getTeamsMeetingCapability?: () => Promise<TeamsMeetingCapability>;
  scheduleTeamsMeeting?: (input: ScheduleTeamsMeetingFromClientInput) => Promise<ScheduleTeamsMeetingFromClientResult>;
  refreshMeetingRecordings?: (meetingId: string) => Promise<IOnlineMeeting | ActionMessageError | ActionPermissionError>;
  getSlaPolicies: () => Promise<ISlaPolicy[]>;
}

const ClientCrossFeatureContext = createContext<ClientCrossFeatureCallbacks | null>(null);

export function useClientCrossFeature(): ClientCrossFeatureCallbacks {
  const ctx = useContext(ClientCrossFeatureContext);
  if (!ctx) {
    throw new Error(
      'useClientCrossFeature must be used within a ClientCrossFeatureProvider. ' +
      'Wrap your client page in a provider from the composition layer.'
    );
  }
  return ctx;
}

export function useOptionalClientCrossFeature(): ClientCrossFeatureCallbacks | null {
  return useContext(ClientCrossFeatureContext);
}

export function ClientCrossFeatureProvider({
  value,
  children,
}: {
  value: ClientCrossFeatureCallbacks;
  children: ReactNode;
}) {
  return (
    <ClientCrossFeatureContext.Provider value={value}>
      {children}
    </ClientCrossFeatureContext.Provider>
  );
}
