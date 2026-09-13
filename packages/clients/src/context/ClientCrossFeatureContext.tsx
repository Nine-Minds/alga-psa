'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { TabContent } from '@alga-psa/ui/components/CustomTabs';
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

export interface HourBlocksSectionRenderProps {
  clientId: string;
  currencyCode?: string;
}

export interface ClientOpportunitiesRenderProps {
  clientId: string;
  clientName: string;
  clientLifecycleStatus?: string | null;
}

export interface ClientBillingProfileSpendRenderProps {
  clientId: string;
}

export interface ClientUnresolvedChargeReviewRenderProps {
  clientId: string;
  windowStart: string;
  windowEnd: string;
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

export interface HourBlocksRenderProps {
  clientId: string;
  currencyCode?: string;
}

export interface TeamsMeetingCapability {
  available: boolean;
  reason?: string;
  recordingsAvailable?: boolean;
  recordingReason?: string;
  sendMeetingInvites?: boolean;
}

export interface ScheduleTeamsMeetingFromClientInput {
  subject: string;
  startDateTime: string | Date;
  endDateTime: string | Date;
  client_id?: string | null;
  contact_name_id?: string | null;
  attendees?: Array<{ emailAddress: string; name?: string }>;
  /** Who the logged interaction belongs to — distinct from the Teams organizer. Defaults to the creator. */
  interactionUserId?: string;
  /** Also place the meeting on an AlgaPSA calendar. */
  createScheduleEntry?: boolean;
  /** Whose AlgaPSA calendar to book — distinct from the Teams invitees. Defaults to the creator. */
  scheduleAssignedUserIds?: string[];
}

export interface ScheduleTeamsMeetingFromClientResult {
  success: boolean;
  data?: {
    /** Null when the meeting was attached to an existing schedule entry (no interaction is created). */
    interaction_id: string | null;
    meeting_id: string;
    schedule_entry_id: string | null;
    join_url: string;
  };
  error?: string;
}

/**
 * Feature slots the app-owned co-managed integration supplies once it has
 * resolved product eligibility, the release flag, and client read authority.
 * A null slots value means "no feature UI" and the ordinary client renders.
 */
export interface ClientCoManagedSlots {
  /** Compact relationship state summary for the client header. */
  summary: ReactNode;
  /** The stable `co-managed` entry registered in the client tab registry. */
  tab: TabContent;
  /**
   * Replaces the Tickets tab content with the authorized native-plus-shared
   * queue scoped to this client. Absent keeps the native ticket list.
   */
  ticketsContent?: ReactNode;
}

export interface ClientCoManagedIntegrationProps {
  clientId: string;
  clientName: string;
  /** Instance-specific prefix so a full page and a drawer can coexist. */
  idPrefix: string;
  /** Validated query values selecting a relationship and internal section. */
  relationshipId?: string | null;
  section?: string | null;
  /** Opens a registered client tab in place without a server navigation. */
  onOpenTab?: (tabId: string) => void;
  /** Render the client body with the current feature slots (or none). */
  children: (slots: ClientCoManagedSlots | null) => ReactNode;
}

export type RenderClientCoManagedIntegration = (props: ClientCoManagedIntegrationProps) => ReactNode;

export interface ClientCrossFeatureCallbacks {
  renderQuickAddTicket: (props: QuickAddTicketRenderProps) => ReactNode;
  getTicketFormOptions: () => Promise<TicketFormOptions>;
  renderSurveySummaryCard: (props: SurveySummaryRenderProps) => ReactNode;
  renderClientAssets: (props: ClientAssetsRenderProps) => ReactNode;
  /** Optional: prepaid hour blocks on the client billing tab (billing owns the component; clients must not import it directly). */
  renderHourBlocksSection?: (props: HourBlocksSectionRenderProps) => ReactNode;
  /** Optional: the Opportunities tab on client detail (provided by the composition layer when the module is available). */
  renderClientOpportunities?: (props: ClientOpportunitiesRenderProps) => ReactNode;
  /**
   * Optional: spend broken down by billing profile. Lives in the billing
   * package, which the clients package must not depend on, so it arrives
   * through this seam. Renders nothing for a single-profile client.
   */
  renderClientBillingProfileSpend?: (props: ClientBillingProfileSpendRenderProps) => ReactNode;
  /**
   * Optional: the queue of time entries and usage records with no contract
   * line, and the two remedies for them. Also lives in the billing package.
   */
  renderClientUnresolvedChargeReview?: (props: ClientUnresolvedChargeReviewRenderProps) => ReactNode;
  renderClientTickets: (props: ClientTicketsRenderProps) => ReactNode;
  renderContactTickets: (props: ContactTicketsRenderProps) => ReactNode;
  renderContractWizard?: (props: ContractWizardRenderProps) => ReactNode;
  renderContractQuickAdd?: (props: ContractQuickAddRenderProps) => ReactNode;
  /** Optional: the Hour Blocks section on client detail (provided by the composition layer). */
  renderHourBlocks?: (props: HourBlocksRenderProps) => ReactNode;
  /** Open a ticket in the shared drawer, keeping the current page underneath. */
  openTicketDetails?: (ticketId: string) => Promise<void>;
  getTeamsMeetingCapability?: () => Promise<TeamsMeetingCapability>;
  scheduleTeamsMeeting?: (input: ScheduleTeamsMeetingFromClientInput) => Promise<ScheduleTeamsMeetingFromClientResult>;
  refreshMeetingRecordings?: (meetingId: string) => Promise<IOnlineMeeting | ActionMessageError | ActionPermissionError>;
  getSlaPolicies: () => Promise<ISlaPolicy[]>;
  /**
   * Optional: app-owned co-managed integration for the client record. When
   * absent (AlgaDesk, community, or a deployment without the feature) the
   * ordinary client renders with no feature slots.
   */
  renderClientCoManagedIntegration?: RenderClientCoManagedIntegration;
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
