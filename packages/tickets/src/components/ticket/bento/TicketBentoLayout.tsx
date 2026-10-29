'use client';

import React, { Suspense, useRef } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { User, Clock, Users, Pencil, ClipboardList } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import Spinner from '@alga-psa/ui/components/Spinner';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { BillingProfilePicker } from '@alga-psa/ui/components/BillingProfilePicker';
import EntityChip from '@alga-psa/ui/components/EntityChip';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { ContentCardVariantProvider, ContentCardFooter } from '@alga-psa/ui/components';
import { ActionSurface } from '@alga-psa/ui/components/ActionSurface';
import { CallLink } from '@alga-psa/ui/components/CallLink';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import type {
  IClient,
  IComment,
  IContact,
  ITicket,
  ITicketResource,
  IUser,
  IUserWithRoles,
  ITeam,
} from '@alga-psa/types';
import type { CommentUserAuthor, CommentContactAuthor } from '../../../lib/commentAuthorResolution';
import type { PartyDisplayTags } from '../../../lib/partyDisplayTags';
import type { ITicketExternalLinkView } from '../../../actions/externalLinks/externalLinkActions';
import TicketChecklistSection from './../TicketChecklistSection';
import { TicketCredentialsSection } from './../TicketCredentialsSection';
import { TicketExternalLinksSection } from './../TicketExternalLinksSection';
import { DocumentsTile } from './DocumentsTile';
import type { TicketScreenBootstrap } from '../../../lib/ticketScreenBootstrap';
import TicketTimeEntries from './../TicketTimeEntries';
import { TicketStopwatchControls } from '../TicketStopwatchControls';
import TicketMaterialsCard from './../TicketMaterialsCard';
import TicketWatchListCard from './../TicketWatchListCard';
import type { CommentEmailRecipientsPayload } from '../CommentEmailRecipientsControl';
import { useTicketDataSource } from '../TicketDataSourceContext';
import { resolveTicketFrozenFields } from '../../../lib/ticketDataSource';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile, BentoTileAddButton, BentoTileEmpty, BentoTileEmptyScope, BentoTileSkeleton, BentoCollapseEmptyTiles } from '@alga-psa/ui/components/bento/BentoTile';
import { BentoBoard, type BentoBoardTile } from '@alga-psa/ui/components/bento/BentoBoard';
import { BentoHero } from './BentoHero';
import { BentoTimelineTile } from './BentoTimelineTile';
import { SlaClocksTile } from './SlaClocksTile';
import { ScheduledWorkTile, AppointmentRequestsTile, CallsEmailsTile, BillingSummary } from './dataTiles';
import { TimeLoggedSummary } from './TimeLoggedSummary';
import { useTeamAvatarUrl } from './useTeamAvatarUrl';
import { resolveTicketCallPhone } from './ticketCallPhone';
import { formatTicketLocationDisplay } from '../../../lib/formatTicketLocation';
import type { TicketSlaFields } from './slaClocks';
import type { TicketLiveConflictState } from '../ticketLiveFields';
import type { TicketNotificationSuppressionValue } from '../TicketNotificationSuppressionControl';
import { resolveBoardStopwatchEnabled } from '../../../lib/boardLiveTicketTimer';

export interface TicketBentoLayoutProps {
  id: string;
  /** Observed by TicketDetails' sticky header to float the title on scroll. */
  titleRef?: React.Ref<HTMLHeadingElement>;
  ticket: ITicket &
    TicketSlaFields & {
      tenant?: string;
      source?: string | null;
      escalated?: boolean;
      escalation_level?: number | null;
    };
  // Hero
  statusOptions: { value: string; label: string; is_closed?: boolean; board_id?: string | null }[];
  priorityOptions: { value: string; label: string }[];
  boardOptions: { value: string; label: string }[];
  agentOptions: { value: string; label: string }[];
  onSelectChange: (field: keyof ITicket, newValue: string | null) => Promise<void> | void;
  /** Coalesced multi-field hero save; forwarded to BentoHero. */
  onBatchSelectChange?: (
    changes: Record<string, unknown>,
    options?: TicketNotificationSuppressionValue
  ) => Promise<boolean | void> | boolean | void;
  /** Persists the hero description when no batch handler is wired. */
  onUpdateDescription?: (content: string) => Promise<boolean>;
  responseStateTrackingEnabled?: boolean;
  defaultReplyInternal?: boolean;
  hideSlaStatus?: boolean;
  /** App-layer slot content (`slots.appSection`), rendered as its own tile. */
  appSection?: React.ReactNode;
  /** App-layer slot content (`slots.timeSummary`), rendered under the time summary. */
  timeSummarySlot?: React.ReactNode;
  /** Hides the billing rollup tile (AlgaDesk has no billing surface). */
  hideBilling?: boolean;
  /** Hides the Scheduled work / Appointment requests tiles (AlgaDesk has no scheduling surface). */
  hideScheduling?: boolean;
  workflowLocked?: boolean;
  onOpenAllFields: () => void;
  tags?: any[];
  onTagsChange?: (tags: any[]) => void;
  taskActions?: React.ReactNode;
  /** Injected quick-invoice-a-ticket action (billing package). */
  quickInvoiceActions?: React.ReactNode;
  receiveEquipmentActions?: React.ReactNode;
  /** Created/Updated stamps folded into the hero's metadata line. */
  heroMeta?: React.ReactNode;
  /** Secondary ticket actions menu, placed after All fields in the hero. */
  heroMoreActions?: React.ReactNode;
  onResolveAndClose?: () => void;
  resolveAndCloseDisabled?: boolean;
  liveHighlightedFields?: string[];
  liveFrozenFields?: string[];
  liveFieldConflicts?: Partial<Record<string, TicketLiveConflictState>>;
  onKeepLiveConflict?: (field: string) => void;
  onTakeLiveConflict?: (field: string) => void;
  liveEditingUsers?: Partial<Record<string, string[]>>;
  onLiveEditingFieldChange?: (field: string | null) => void;
  onLiveDirtyFieldsChange?: (fields: string[]) => void;
  /** Opens the agent schedule drawer (global drawer system). */
  onAgentClick?: (userId: string) => void;
  /** Client locations for resolving the ticket's location display line. */
  locations?: {
    location_id: string;
    location_name?: string | null;
    address_line1?: string | null;
    city?: string | null;
    state_province?: string | null;
    postal_code?: string | null;
    is_default?: boolean | null;
    phone?: string | null;
  }[];
  /** Opens the scheduler drawer pre-scoped to this ticket (global drawer system). */
  onScheduleWork?: () => void;
  /** Opens an existing schedule entry linked to this ticket for editing. */
  onOpenScheduleEntry?: (entryId: string) => void;
  /** Bumped by the parent after scheduled work changes so the "Scheduled work" tile refetches. */
  scheduleRefreshKey?: number;
  // Timeline
  conversations: IComment[];
  userMap: Record<string, CommentUserAuthor>;
  contactMap: Record<string, CommentContactAuthor>;
  timelineRefreshKey: number | string;
  timelineInitialOrder: 'asc' | 'desc';
  editorKey: number;
  isSubmitting?: boolean;
  onNewCommentContentChange: (content: PartialBlock[]) => void;
  onAddNewComment: (
    isInternal: boolean,
    isResolution: boolean,
    closeStatusId?: string | null,
    options?: TicketNotificationSuppressionValue,
    schedule?: { publishAt: string; timeZone: string } | null,
    emailRecipients?: CommentEmailRecipientsPayload,
  ) => Promise<boolean>;
  closedStatusOptions?: { value: string; label: string }[];
  // Comment affordances on timeline nodes (reactions, edit, delete).
  currentUser?: { id: string; name: string; email?: string } | null;
  isEditing: boolean;
  currentComment: IComment | null;
  onContentChange: (content: PartialBlock[]) => void;
  onSaveComment: (updates: Partial<IComment>) => void;
  onCloseEdit: () => void;
  onEditComment: (comment: IComment) => void;
  onDeleteComment: (comment: IComment) => void;
  reactionRefreshVersion?: number;
  canViewCommentMetadataDebug?: boolean;
  onClipboardImageUploaded?: () => void;
  uploadTicketAttachmentAction?: (
    formData: FormData,
    params: { userId: string; ticketId: string }
  ) => Promise<any>;
  deleteDraftTicketAttachmentImagesAction?: (input: {
    ticketId: string;
    documentIds: string[];
  }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
  resolveTicketAttachmentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
  /** Threaded reply pipeline (same handler the conversation view gets). */
  onAddReplyComment?: (
    content: PartialBlock[],
    parentCommentId: string,
    isInternal: boolean,
    emailRecipients?: CommentEmailRecipientsPayload,
  ) => Promise<boolean>;
  /**
   * Server-started data promises from the RSC page. Tiles resolve them via
   * React use() behind <Suspense> skeletons — zero fetch-on-mount requests.
   */
  bentoStreams?: NonNullable<TicketScreenBootstrap['streams']>;
  // Description caption / contact
  createdByUser?: IUser | null;
  contactInfo?: IContact | null;
  client?: IClient | null;
  /** Requester and client chip tags for the viewer (display rules). */
  displayTags?: PartyDisplayTags;
  onContactClick: () => void;
  onClientClick: () => void;
  /** Clients list, used to scope the quick-add-contact modal. */
  clients?: IClient[];
  /** Persists a contact change (or clear, when null). Enables inline contact editing on the tile — the picker pool is the existing `contacts` prop. */
  onChangeContact?: (contactId: string | null) => void;
  /** Repoints the ticket to a different client (resets contact + location). Enables the inline ClientPicker on the tile. */
  onChangeClient?: (clientId: string) => void;
  /** Saves the ticket's location. Enables the inline location picker on the tile. */
  onChangeLocation?: (locationId: string | null) => void;
  /**
   * Saves the ticket's billing profile. The picker renders itself away while
   * the client holds a single profile (decision D6), so wiring this is safe on
   * every client.
   */
  onChangeBillingProfile?: (billingProfileId: string | null) => void;
  // Checklist
  checklistItems: any[];
  onChecklistItemsChanged: (items: any[]) => void;
  // External system links
  externalLinks?: ITicketExternalLinkView[];
  onExternalLinksChanged?: (links: ITicketExternalLinkView[]) => void;
  // Timer / time entries
  hideTimeEntry?: boolean;
  isLiveTicketTimerEnabled?: boolean;
  timeDescription: string;
  onTimeDescriptionChange: (value: string) => void;
  /** Called after a stopwatch Stop saved its time entry, so the time list refreshes. */
  onTimeEntryLogged?: () => void;
  onAddTimeEntry: () => void;
  /** True while the time-entry launch chain is in flight; disables the button. */
  isLaunchingTimeEntry?: boolean;
  userId?: string;
  showWeekday?: boolean;
  timeEntriesRefreshKey?: number;
  onEditTimeEntry?: (entry: any) => void;
  onDeleteTimeEntry?: (entry: any) => void;
  // Team & watchers
  additionalAgents: ITicketResource[];
  availableAgents: IUserWithRoles[];
  onAddAgent: (userId: string) => void;
  /** Takes the ticket_resources assignment id (not the user id). */
  onRemoveAgent: (assignmentId: string) => void;
  teams?: ITeam[];
  team?: ITeam | null;
  onAssignTeam?: (teamId: string) => Promise<void> | void;
  onRemoveTeamAssignment?: (
    mode: 'remove_all' | 'keep_all' | 'selective',
    keepUserIds?: string[],
  ) => Promise<void> | void;
  onAddWatchers?: (inputs: any[]) => Promise<boolean>;
  onSetWatcherActive?: (email: string, active: boolean) => Promise<boolean>;
  onRemoveWatcher?: (email: string) => Promise<boolean>;
  watchListSaving?: boolean;
  contacts?: IContact[];
  allContactsForWatchList?: IContact[];
  allContactsForWatchListLoading?: boolean;
  onLoadAllContactsForWatchList?: () => Promise<void>;
  // Materials / feedback / documents / assets
  hideMaterials?: boolean;
  surveySummaryCard?: React.ReactNode;
  associatedAssets?: React.ReactNode;
  documents: any[];
  onDocumentCreated: () => Promise<void>;
  disableAttachmentFolderSelection?: boolean;
  disableAttachmentSharing?: boolean;
  disableAttachmentLinking?: boolean;
}

/** Select sentinel for "this ticket has no specific location". */
const NO_LOCATION_VALUE = 'none';

// The picker takes its loader as a prop so the single-profile invisibility rule
// has one implementation across every surface that shows a billing profile.

/**
 * The "Grid" ticket layout: hero band on top, unified timeline as the center
 * spine, who/what tiles on the left, state tiles on the right. Every tile is
 * fed by the same state and handlers TicketDetails already owns — this
 * component arranges, it does not own writes.
 */
export function TicketBentoLayout(props: TicketBentoLayoutProps) {
  const { id, ticket } = props;
  const { t } = useTranslation('features/tickets');
  const dataSource = useTicketDataSource();
  const { capabilities } = dataSource;
  // A read-only screen offers no add actions.
  const screenReadOnly = dataSource.screen.readOnly === true;
  // Screen-declared frozen fields only: live-collaboration conflicts reach BentoHero (liveFrozenFields), never these gates.
  const frozenFieldSet = React.useMemo(() => new Set(resolveTicketFrozenFields(dataSource.screen)), [dataSource.screen]);
  const { getUserAvatarUrlsBatchAction, getTeamAvatarUrlsBatchAction } = dataSource.avatars;
  const { getClientBillingProfiles } = dataSource.people;
  const loadClientBillingProfiles = (clientId: string) => getClientBillingProfiles(clientId);
  const ticketId = ticket.ticket_id ?? '';
  // Guards against re-entrant add/remove churn on rapid multi-select changes.
  const isProcessingAgentsRef = useRef(false);

  const selectedLocation = React.useMemo(() => {
    if (!ticket.location_id || !props.locations) return null;
    return props.locations.find((loc) => loc.location_id === ticket.location_id) ?? null;
  }, [ticket.location_id, props.locations]);

  // The location line reads exactly as the list layout's Location field does:
  // the ticket's own location, else the client default marked as such, else a
  // plain "none". Showing the inherited default matters because that is the
  // location billing and dispatch will use.
  const defaultLocation = React.useMemo(
    () => (props.locations ?? []).find((location) => location.is_default) ?? null,
    [props.locations],
  );
  const ticketLocation = React.useMemo(() => {
    const unnamedLocationLabel = t('quickAdd.unnamedLocation', 'Unnamed Location');
    if (selectedLocation) {
      return formatTicketLocationDisplay(selectedLocation, unnamedLocationLabel);
    }
    if (defaultLocation) {
      return `${formatTicketLocationDisplay(defaultLocation, unnamedLocationLabel)} ${t('properties.defaultSuffix', '(Default)')}`;
    }
    return null;
  }, [defaultLocation, selectedLocation, t]);

  const canChangeLocation = Boolean(props.onChangeLocation) && (props.locations ?? []).length > 0;
  const [locationPickerOpen, setLocationPickerOpen] = React.useState(false);
  const [selectedLocationId, setSelectedLocationId] = React.useState<string | null>(null);
  const locationOptions = React.useMemo(() => {
    const unnamedLocationLabel = t('quickAdd.unnamedLocation', 'Unnamed Location');
    const defaultSuffix = t('properties.defaultSuffix', '(Default)');
    return [
      { value: NO_LOCATION_VALUE, label: t('properties.noSpecificLocation', 'No specific location') },
      ...(props.locations ?? []).map((location) => ({
        value: location.location_id,
        label:
          formatTicketLocationDisplay(location, unnamedLocationLabel) +
          (location.is_default ? ` ${defaultSuffix}` : ''),
      })),
    ];
  }, [props.locations, t]);

  const contactPhone = resolveTicketCallPhone({
    contact: props.contactInfo,
    locationPhone: selectedLocation?.phone,
    clientPhone: props.client?.phone_no,
  });

  // Inline contact editing: the tile picks from the same client-scoped contacts
  // the all-fields drawer uses, and quick-add attaches a brand-new one. Editing
  // is only offered when TicketDetails wired a change handler and the ticket has
  // a client to scope the picker/quick-add to.
  const {
    renderQuickAddContact,
    renderQuickAddInteraction,
    openInteractionDetails,
  } = useQuickAddClient();
  const effectiveClientId = props.client?.client_id ?? ticket.client_id ?? undefined;
  const canEditContact = Boolean(props.onChangeContact) && Boolean(effectiveClientId) && !screenReadOnly && !frozenFieldSet.has('contact_name_id');
  const [contactEditOpen, setContactEditOpen] = React.useState(false);
  const [selectedContactId, setSelectedContactId] = React.useState<string | null>(null);
  const [pickerContacts, setPickerContacts] = React.useState<IContact[]>(props.contacts ?? []);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = React.useState(false);

  // Repoint the ticket to a different client. Mirrors the legacy Contact Info
  // card: an inline ClientPicker that, on save, resets contact + location
  // (handled by the wired onChangeClient handler in TicketDetails).
  // Frozen (read-only screen, or a field the source cannot write) means no change affordance.
  const canChangeClient = Boolean(props.onChangeClient) && !screenReadOnly && !frozenFieldSet.has('client_id');
  const [clientPickerOpen, setClientPickerOpen] = React.useState(false);
  const [selectedNewClientId, setSelectedNewClientId] = React.useState<string | null>(null);
  const [clientFilterState, setClientFilterState] = React.useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = React.useState<'all' | 'company' | 'individual'>('all');
  // props.clients can contain the same company more than once (joins upstream);
  // dedupe by client_id so the picker shows each company once.
  const uniqueClients = React.useMemo(() => {
    const seen = new Set<string>();
    return (props.clients ?? []).filter((client) => {
      if (!client || typeof client.client_id === 'undefined') return false;
      if (seen.has(client.client_id)) return false;
      seen.add(client.client_id);
      return true;
    });
  }, [props.clients]);

  // Log call/email: the quick-add-interaction flow needs a client, so it is only
  // offered when the ticket resolves to one. A successful add bumps the refresh
  // key so the Calls and emails tile refetches and shows the new row.
  const canLogInteraction = Boolean(effectiveClientId) && !screenReadOnly;
  const [isLogInteractionOpen, setIsLogInteractionOpen] = React.useState(false);
  const [interactionRefreshKey, setInteractionRefreshKey] = React.useState(0);
  const logInteractionContactId = props.contactInfo?.contact_name_id ?? ticket.contact_name_id ?? null;
  const handleInteractionClick = React.useCallback((interactionId: string) => {
    void openInteractionDetails(interactionId, () => {
      setInteractionRefreshKey((key) => key + 1);
    });
  }, [openInteractionDetails]);

  React.useEffect(() => {
    setPickerContacts(props.contacts ?? []);
  }, [props.contacts]);

  const openContactEditor = React.useCallback(() => {
    setSelectedContactId(props.contactInfo?.contact_name_id ?? null);
    setContactEditOpen(true);
  }, [props.contactInfo?.contact_name_id]);

  // Billing rides in the time tile on this layout, so each half is gated on its own capability
  // and the tile shows when either is on.
  const showTime = capabilities.timeEntry && !props.hideTimeEntry;
  const showBilling = capabilities.billing && !props.hideBilling && !props.hideTimeEntry;
  const timerTile = showTime || showBilling ? (
    <BentoTile
      id={`${id}-time-tile`}
      title={!showTime ? t('bento.tiles.billing', 'Billing') : !showBilling ? t('bento.tiles.timeLogged', 'Time logged') : t('bento.tiles.timeAndBilling', 'Time & billing')}
      icon={<Clock className="h-4 w-4" />}
      action={!showTime ? undefined :
        <BentoTileAddButton
          id={`${id}-add-time-entry`}
          label={t('bento.tiles.addTimeEntry', 'Add time entry')}
          onClick={props.onAddTimeEntry}
          busy={props.isLaunchingTimeEntry}
        />
      }
    >
      {showTime ? (<>
      <Suspense
        fallback={
          <div
            id={`${id}-time-summary-loading`}
            className="animate-pulse bg-[rgb(var(--color-border-100))] h-8 rounded-md mb-3"
          />
        }
      >
        <TimeLoggedSummary
          id={`${id}-time-summary`}
          ticketId={ticketId}
          refreshKey={props.timeEntriesRefreshKey}
          initialSummary={props.bentoStreams?.timeEntries}
        />
      </Suspense>
      {props.timeSummarySlot ?? null}
      {/* The hero chip carries the stopwatch and its description; with the
          board's stopwatch off, the description for manual entries lives here. */}
      {ticketId && !resolveBoardStopwatchEnabled(props.isLiveTicketTimerEnabled) ? (
        <TicketStopwatchControls
          id={`${id}-timer`}
          ticketId={ticketId}
          variant="notes"
          enabled={resolveBoardStopwatchEnabled(props.isLiveTicketTimerEnabled)}
          timeDescription={props.timeDescription}
          onTimeDescriptionChange={props.onTimeDescriptionChange}
          masterTicketId={ticket.master_ticket_id ?? null}
          onTimeEntryLogged={props.onTimeEntryLogged}
        />
      ) : null}


      {ticketId && props.userId ? (
        <Suspense
          fallback={
            <div
              id={`${id}-time-entries-loading-fallback`}
              className="animate-pulse bg-[rgb(var(--color-border-100))] h-10 rounded-md"
            />
          }
        >
          <TicketTimeEntries
            id={`${id}-time-entries`}
            ticketId={ticketId}
            currentUserId={props.userId}
            showWeekday={props.showWeekday}
            refreshKey={props.timeEntriesRefreshKey}
            onEditEntry={props.onEditTimeEntry}
            onDeleteEntry={props.onDeleteTimeEntry}
            initialSummary={props.bentoStreams?.timeEntries}
          />
        </Suspense>
      ) : null}
      </>) : null}

      {showBilling ? (
        <div className="mt-3 pt-3 border-t border-[rgb(var(--color-border-100))]">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] mb-1.5">
            {t('bento.tiles.billing', 'Billing')}
          </h4>
          <Suspense fallback={<div id={`${id}-billing-loading`} className="animate-pulse bg-[rgb(var(--color-border-100))] h-8 rounded-md" />}>
            <BillingSummary
              id={`${id}-billing`}
              ticketId={ticketId}
              refreshKey={props.timeEntriesRefreshKey}
              initialData={props.bentoStreams?.billingRollup}
              footer={capabilities.quickInvoice && props.quickInvoiceActions ? <ActionSurface kind="tile">{props.quickInvoiceActions}</ActionSurface> : undefined}
            />
          </Suspense>
        </div>
      ) : null}
    </BentoTile>
  ) : null;

  const tasksTile = capabilities.createProjectTask && props.taskActions ? (
    <BentoTile id={`${id}-tasks-tile`} title={t('bento.tiles.projectTasks', 'Project tasks')} icon={<ClipboardList className="h-4 w-4" />}>
      <ActionSurface kind="tile">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{props.taskActions}</div>
      </ActionSurface>
    </BentoTile>
  ) : null;

  const assignedTeamAvatarUrl = useTeamAvatarUrl(props.team?.team_id, props.team?.tenant, getTeamAvatarUrlsBatchAction);

  const teamTile = (
    <BentoTile
      id={`${id}-team-tile`}
      title={t('bento.tiles.team', 'Team')}
      icon={<Users className="h-4 w-4" />}
    >
      <div className="space-y-2 mb-3">
        {ticket.assigned_team_id && props.team ? (
          <div className="flex items-center gap-2 text-sm" {...withDataAutomationId({ id: `${id}-team-assigned` })}>
            <TeamAvatar
              teamId={props.team.team_id}
              teamName={props.team.team_name || t('bento.tiles.teamFallback', 'Team')}
              avatarUrl={assignedTeamAvatarUrl}
              size="xs"
            />
            <span className="text-[rgb(var(--color-text-700))] truncate">
              {props.team.team_name || t('bento.tiles.teamFallback', 'Team')}
            </span>
          </div>
        ) : null}
        <MultiUserAndTeamPicker
          id={`${id}-team-agents`}
          values={props.additionalAgents.filter((a) => a.additional_user_id).map((a) => a.additional_user_id!)}
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
          teams={props.teams}
          teamSectionLabel={t('bento.tiles.teamSectionLabel', 'Assign a team')}
          teamValues={ticket.assigned_team_id ? [ticket.assigned_team_id] : []}
          onTeamValuesChange={(selectedTeamIds) => {
            const currentTeamId = ticket.assigned_team_id ?? null;
            // The picker appends the newly picked team to the existing selection,
            // so the "new" id is whichever one isn't the currently assigned team.
            const newTeamId = selectedTeamIds.find((tid) => tid !== currentTeamId);
            if (newTeamId) {
              // assignTeamToTicket reassigns server-side (handleAssignTeam swaps the
              // team in state), so switching teams is a straight call — no dialog.
              props.onAssignTeam?.(newTeamId);
            } else if (currentTeamId && !selectedTeamIds.includes(currentTeamId)) {
              // Selection cleared / team pill removed → drop assignment, keep agents.
              props.onRemoveTeamAssignment?.('keep_all');
            }
          }}
          onValuesChange={async (newUserIds) => {
            if (isProcessingAgentsRef.current) {
              return;
            }
            isProcessingAgentsRef.current = true;

            try {
              const currentUserIds = props.additionalAgents
                .filter((a) => a.additional_user_id)
                .map((a) => a.additional_user_id!);

              const addedUserIds = newUserIds.filter((uid) => !currentUserIds.includes(uid));
              const removedUserIds = currentUserIds.filter((uid) => !newUserIds.includes(uid));

              for (const userId of addedUserIds) {
                await props.onAddAgent(userId);
              }

              for (const userId of removedUserIds) {
                const agent = props.additionalAgents.find((a) => a.additional_user_id === userId);
                if (agent?.assignment_id) {
                  await props.onRemoveAgent(agent.assignment_id);
                }
              }
            } finally {
              isProcessingAgentsRef.current = false;
            }
          }}
          users={props.availableAgents.filter((agent) => agent.user_id !== ticket.assigned_to)}
          size="sm"
          placeholder={t('bento.tiles.addAgentsOrTeam', 'Add agents or a team…')}
          onUserClick={props.onAgentClick}
          userClickLabel={t('bento.hero.viewSchedule', 'View schedule')}
        />
      </div>

    </BentoTile>
  );

  // Side tiles. Each declares its zone (people & records on the start side,
  // the technician's work on the end side) and its rank; BentoBoard places
  // them for the width the ticket actually gets. Pinned tiles ride above the
  // timeline on narrow screens: who it's for, the clock, and the timer.
  const sideTiles = ([
    { key: 'contact', zone: 'start', group: 'customer', rank: 10, node: (
      <BentoTile
        id={`${id}-contact-tile`}
        title={t('bento.tiles.contact', 'Contact')}
        icon={<User className="h-4 w-4" />}
        action={
          canEditContact ? (
            <button
              id={`${id}-contact-edit`}
              type="button"
              aria-label={t('bento.tiles.editContact', 'Edit contact')}
              className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))]"
              onClick={() => {
                if (contactEditOpen) {
                  setContactEditOpen(false);
                  setSelectedContactId(null);
                } else {
                  openContactEditor();
                }
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          ) : undefined
        }
      >
        {contactEditOpen ? (
          <div className="space-y-2">
            <ContactPicker
              id={`${id}-contact-picker`}
              contacts={pickerContacts}
              value={selectedContactId ?? props.contactInfo?.contact_name_id ?? ''}
              onValueChange={setSelectedContactId}
              clientId={effectiveClientId}
              placeholder={t('bento.tiles.selectOrChangeContact', 'Select or change contact')}
              onAddNew={() => setIsQuickAddContactOpen(true)}
            />
            <div className="flex items-center justify-between gap-2">
              {props.contactInfo ? (
                <button
                  id={`${id}-contact-clear`}
                  type="button"
                  className="text-xs font-medium text-red-500 hover:text-red-700"
                  onClick={() => {
                    props.onChangeContact?.(null);
                    setContactEditOpen(false);
                    setSelectedContactId(null);
                  }}
                >
                  {t('bento.tiles.clearContact', 'Clear contact')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button
                  {...withDataAutomationId({ id: `${id}-contact-cancel` })}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setContactEditOpen(false);
                    setSelectedContactId(null);
                  }}
                >
                  {t('bento.tiles.cancel', 'Cancel')}
                </Button>
                <Button
                  {...withDataAutomationId({ id: `${id}-contact-save` })}
                  size="sm"
                  onClick={() => {
                    props.onChangeContact?.(selectedContactId);
                    setContactEditOpen(false);
                  }}
                >
                  {t('bento.tiles.save', 'Save')}
                </Button>
              </div>
            </div>
          </div>
        ) : props.contactInfo || props.client ? (
          <div className="space-y-1.5 text-sm">
            {props.contactInfo ? (
              <div className="flex items-center gap-2 min-w-0 font-medium">
                <EntityChip
                  kind="contact"
                  id={props.contactInfo.contact_name_id || ''}
                  name={props.contactInfo.full_name || ''}
                  imageUrl={props.contactInfo.avatarUrl ?? null}
                  tags={props.displayTags?.contact}
                  maxBadges={3}
                  buttonId={`${id}-contact-open`}
                  onClick={props.onContactClick}
                />
              </div>
            ) : canEditContact ? (
              <button
                id={`${id}-contact-add`}
                type="button"
                className="font-medium text-[rgb(var(--color-primary-600))] hover:underline text-left"
                onClick={openContactEditor}
              >
                {t('bento.tiles.addContact', 'Add contact')}
              </button>
            ) : (
              <BentoTileEmptyScope><BentoTileEmpty id={`${id}-contact-none`}>{t('bento.tiles.noContactOnTicket', 'No contact on this ticket')}</BentoTileEmpty></BentoTileEmptyScope>
            )}
            {props.contactInfo?.email ? (
              <div className="text-[rgb(var(--color-text-600))] truncate">{props.contactInfo.email}</div>
            ) : null}
            {contactPhone ? (
              <div className="text-[rgb(var(--color-text-600))] truncate">
                <CallLink
                  id={`${id}-contact-phone-call`}
                  phoneNumber={contactPhone}
                  callIntent={ticketId ? { ticketId } : undefined}
                />
              </div>
            ) : null}
            {props.client ? (
              <div className="pt-1 border-t border-[rgb(var(--color-border-100))]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[rgb(var(--color-text-400))]">{t('bento.tiles.client', 'Client')}</span>{' '}
                  <span className="min-w-0 font-medium">
                    <EntityChip
                      kind="client"
                      id={props.client.client_id}
                      name={props.client.client_name}
                      imageUrl={props.client.logoUrl ?? null}
                      tags={props.displayTags?.client}
                      maxBadges={3}
                      buttonId={`${id}-client-open`}
                      onClick={props.onClientClick}
                    />
                  </span>
                  {canChangeClient ? (
                    <button
                      id={`${id}-client-edit`}
                      type="button"
                      aria-label={t('bento.tiles.changeClient', 'Change client')}
                      className="ml-auto text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))]"
                      onClick={() => {
                        if (clientPickerOpen) {
                          setClientPickerOpen(false);
                          setSelectedNewClientId(null);
                        } else {
                          setSelectedNewClientId(props.client?.client_id ?? null);
                          setClientPickerOpen(true);
                        }
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
                {clientPickerOpen ? (
                  <div className="mt-1.5 space-y-2">
                    <ClientPicker
                      id={`${id}-client-picker`}
                      clients={uniqueClients}
                      onSelect={setSelectedNewClientId}
                      selectedClientId={selectedNewClientId || props.client?.client_id || ''}
                      filterState={clientFilterState}
                      onFilterStateChange={setClientFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                      fitContent={false}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        {...withDataAutomationId({ id: `${id}-client-cancel` })}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setClientPickerOpen(false);
                          setSelectedNewClientId(null);
                        }}
                      >
                        {t('bento.tiles.cancel', 'Cancel')}
                      </Button>
                      <Button
                        {...withDataAutomationId({ id: `${id}-client-save` })}
                        size="sm"
                        onClick={() => {
                          if (selectedNewClientId && selectedNewClientId !== props.client?.client_id) {
                            props.onChangeClient?.(selectedNewClientId);
                          }
                          setClientPickerOpen(false);
                        }}
                      >
                        {t('bento.tiles.save', 'Save')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* Location and billing profile: both are ticket fields the list
                layout has always shown, and both decide where the work is done
                and who is charged for it, so the grid layout shows them too. */}
            {props.client ? (
              <div className="pt-1 border-t border-[rgb(var(--color-border-100))] space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-[rgb(var(--color-text-400))] shrink-0">
                    {t('properties.location', 'Location')}
                  </span>
                  <span id={`${id}-location-value`} className="min-w-0 flex-1 text-xs text-[rgb(var(--color-text-600))] break-words">
                    {ticketLocation ?? t('properties.noLocationSpecified', 'No location specified')}
                  </span>
                  {canChangeLocation ? (
                    <button
                      id={`${id}-location-edit`}
                      type="button"
                      aria-label={t('bento.tiles.changeLocation', 'Change location')}
                      className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))]"
                      onClick={() => {
                        if (locationPickerOpen) {
                          setLocationPickerOpen(false);
                          setSelectedLocationId(null);
                        } else {
                          setSelectedLocationId(ticket.location_id ?? null);
                          setLocationPickerOpen(true);
                        }
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
                {locationPickerOpen ? (
                  <div className="space-y-2">
                    <CustomSelect
                      id={`${id}-location-select`}
                      value={selectedLocationId ?? NO_LOCATION_VALUE}
                      onValueChange={(value) => setSelectedLocationId(value === NO_LOCATION_VALUE ? null : value)}
                      options={locationOptions}
                      placeholder={t('properties.selectLocation', 'Select location')}
                      className="w-full"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        {...withDataAutomationId({ id: `${id}-location-cancel` })}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setLocationPickerOpen(false);
                          setSelectedLocationId(null);
                        }}
                      >
                        {t('bento.tiles.cancel', 'Cancel')}
                      </Button>
                      <Button
                        {...withDataAutomationId({ id: `${id}-location-save` })}
                        size="sm"
                        onClick={() => {
                          if (selectedLocationId !== (ticket.location_id ?? null)) {
                            props.onChangeLocation?.(selectedLocationId);
                          }
                          setLocationPickerOpen(false);
                        }}
                      >
                        {t('bento.tiles.save', 'Save')}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {/* Renders nothing while the client holds a single profile
                    (decision D6) — the picker itself owns that rule. */}
                {props.onChangeBillingProfile ? (
                  <BillingProfilePicker
                    id={`${id}-billing-profile-picker`}
                    clientId={props.client.client_id}
                    loadProfiles={loadClientBillingProfiles}
                    value={ticket.billing_profile_id ?? null}
                    onChange={props.onChangeBillingProfile}
                    label={t('properties.billingProfile', 'Billing profile')}
                    unassignedLabel={t('properties.billingProfileUnassigned', 'Use the default profile')}
                    hint={t(
                      'properties.billingProfileHint',
                      'Only used when no contract assigns this work to a profile.',
                    )}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            <BentoTileEmptyScope><BentoTileEmpty id={`${id}-contact-empty`}>{t('bento.tiles.noContactOnTicket', 'No contact on this ticket')}</BentoTileEmpty></BentoTileEmptyScope>
            {props.onChangeContact && !effectiveClientId ? (
              <p className="text-xs text-[rgb(var(--color-text-400))]">
                {t('bento.tiles.setClientToAddContact', 'Set a client first to add a contact')}
              </p>
            ) : null}
          </div>
        )}
      </BentoTile>
    ) },
    capabilities.sla && !props.hideSlaStatus ? { key: 'sla', zone: 'end', group: 'work', rank: 20, node: (
      <SlaClocksTile id={`${id}-sla-tile`} ticket={ticket} initialPolicyName={props.bentoStreams?.slaPolicyName} />
    ) } : null,
    timerTile ? { key: 'time', zone: 'end', group: 'work', rank: 22, node: timerTile } : null,
    capabilities.checklist ? { key: 'checklist', zone: 'end', group: 'work', rank: 24, node: (
      <TicketChecklistSection
        id={`${id}-checklist-section`}
        ticketId={ticketId}
        initialItems={props.checklistItems}
        onItemsChanged={props.onChecklistItemsChanged}
      />
    ) } : null,
    !timerTile && props.timeSummarySlot ? { key: 'time', zone: 'end', group: 'work', rank: 22, node: (
      <BentoTile id={`${id}-time-tile`} title={t('bento.tiles.timeLogged', 'Time logged')} icon={<Clock className="h-4 w-4" />}>
        {props.timeSummarySlot}
      </BentoTile>
    ) } : null,
    props.appSection ? { key: 'app-section', zone: 'start', group: 'customer', rank: 11, node: (
      <div id={`${id}-app-section`}>{props.appSection}</div>
    ) } : null,
    capabilities.assets && props.associatedAssets ? { key: 'assets', zone: 'start', group: 'linked', rank: 40, node: (

        <div id={`${id}-assets-container`}>
          <ContentCardFooter
            footer={props.receiveEquipmentActions ? <ActionSurface kind="tile">{props.receiveEquipmentActions}</ActionSurface> : null}
          >
            {props.associatedAssets}
          </ContentCardFooter>
        </div>
    ) } : null,
    tasksTile ? { key: 'tasks', zone: 'end', group: 'work', rank: 26, node: tasksTile } : null,
    frozenFieldSet.has('additional_agents') ? null : { key: 'team', zone: 'start', group: 'who', rank: 12, node: teamTile },
    capabilities.materials && !props.hideMaterials ? { key: 'materials', zone: 'start', group: 'linked', rank: 44, node: (
      <TicketMaterialsCard id={`${id}-materials`} ticketId={ticketId} clientId={ticket.client_id} initialMaterials={props.bentoStreams?.materials} />
    ) } : null,
    capabilities.scheduling && !props.hideScheduling ? { key: 'scheduled', zone: 'end', group: 'work', rank: 28, node: (
      <Suspense fallback={<BentoTileSkeleton id={`${id}-scheduled-work-tile-loading`} title={t('bento.tiles.scheduledWork', 'Scheduled work')} />}>
            <ScheduledWorkTile
              id={`${id}-scheduled-work-tile`}
              ticketId={ticketId}
              refreshKey={props.scheduleRefreshKey}
              initialData={props.bentoStreams?.scheduleEntries}
              onSchedule={screenReadOnly ? undefined : props.onScheduleWork}
              onOpenEntry={screenReadOnly ? undefined : props.onOpenScheduleEntry}
            />
      </Suspense>
    ) } : null,
    capabilities.documents ? { key: 'documents', zone: 'start', group: 'linked', rank: 42, node: (
      <DocumentsTile
        id={`${id}-documents-section`}
        ticketId={ticketId}
        documents={props.documents}
        resolveDocumentViewUrl={props.resolveTicketAttachmentViewUrl}
        forceUploadToRoot={props.disableAttachmentFolderSelection}
        allowDocumentSharing={!props.disableAttachmentSharing}
        allowLinkExistingDocuments={!props.disableAttachmentLinking}
        allowBlockDocuments={!props.disableAttachmentLinking}
        onDocumentCreated={props.onDocumentCreated}
      />
    ) } : null,
    capabilities.scheduling && capabilities.appointmentRequests && !props.hideScheduling ? { key: 'appointments', zone: 'end', group: 'work', rank: 30, node: (
          <AppointmentRequestsTile
            id={`${id}-appointment-requests-tile`}
            ticketId={ticketId}
            refreshKey={props.scheduleRefreshKey}
          />
    ) } : null,
    frozenFieldSet.has('watch_list') ? null : { key: 'watch', zone: 'start', group: 'who', rank: 14, node: (
      <TicketWatchListCard
        id={`${id}-watch-list`}
        attributes={ticket.attributes}
        onAddWatchers={props.onAddWatchers}
        onSetWatcherActive={props.onSetWatcherActive}
        onRemoveWatcher={props.onRemoveWatcher}
        watchListSaving={props.watchListSaving}
        internalUsers={props.availableAgents}
        clientContacts={props.contacts}
        allContacts={props.allContactsForWatchList}
        allContactsLoading={props.allContactsForWatchListLoading}
        onLoadAllContacts={props.onLoadAllContactsForWatchList}
        teams={props.teams}
        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
        getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
      />
    ) },
    capabilities.survey && props.surveySummaryCard ? { key: 'feedback', zone: 'start', group: 'who', rank: 16, node: props.surveySummaryCard } : null,
    { key: 'calls', zone: 'start', group: 'linked', rank: 46, node: (
      <Suspense fallback={<BentoTileSkeleton id={`${id}-calls-emails-tile-loading`} title={t('bento.tiles.callsAndEmails', 'Calls and emails')} />}>
        <CallsEmailsTile
          id={`${id}-calls-emails-tile`}
          ticketId={ticketId}
          refreshKey={interactionRefreshKey}
          viewAllHref={ticket.contact_name_id ? `/msp/contacts/${ticket.contact_name_id}/activity` : undefined}
          callPhoneNumber={contactPhone}
          onLogInteraction={canLogInteraction ? () => setIsLogInteractionOpen(true) : undefined}
          onInteractionClick={handleInteractionClick}
          initialData={props.bentoStreams?.interactions}
        />
      </Suspense>
    ) },
    // Flag-gated; renders nothing when credentials are off.
    capabilities.credentials ? { key: 'passwords', zone: 'start', group: 'linked', rank: 48, node: <TicketCredentialsSection ticketId={ticketId} clientId={ticket.client_id ?? null} readOnly={screenReadOnly} /> } : null,
    capabilities.externalLinks ? { key: 'links', zone: 'start', group: 'linked', rank: 50, node: (
      <TicketExternalLinksSection
        id={`${id}-external-links-section`}
        ticketId={ticketId}
        initialLinks={props.externalLinks}
        onLinksChanged={props.onExternalLinksChanged}
      />
    ) } : null,
  ] as Array<BentoBoardTile | null>).filter((tile): tile is BentoBoardTile => tile !== null);

  // Dialogs owned by side tiles; mounted once, outside the board, so a tier
  // change never remounts an open dialog.
  const sideTileDialogs = (
    <>
      {renderQuickAddContact({
        isOpen: isQuickAddContactOpen,
        onClose: () => setIsQuickAddContactOpen(false),
        onContactAdded: (newContact) => {
          setPickerContacts((prev) => {
            const existingIndex = prev.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
            if (existingIndex >= 0) {
              const next = [...prev];
              next[existingIndex] = newContact;
              return next;
            }
            return [...prev, newContact];
          });
          setSelectedContactId(newContact.contact_name_id);
          setIsQuickAddContactOpen(false);
          setContactEditOpen(true);
        },
        clients: uniqueClients,
        selectedClientId: effectiveClientId ?? null,
      })}
      {isLogInteractionOpen && effectiveClientId
        ? renderQuickAddInteraction({
            id: `${id}-log-interaction`,
            isOpen: isLogInteractionOpen,
            onClose: () => setIsLogInteractionOpen(false),
            entityId: logInteractionContactId ?? effectiveClientId,
            entityType: logInteractionContactId ? 'contact' : 'client',
            clientId: effectiveClientId,
            ticketId: ticketId || undefined,
            onInteractionAdded: () => {
              setIsLogInteractionOpen(false);
              setInteractionRefreshKey((key) => key + 1);
            },
          })
        : null}
    </>
  );

  return (
    // Restyle every ContentCard-based panel in this subtree (checklist, assets,
    // materials, watch list, documents — including the injected assets node) to
    // match the compact bento tiles.
    <ContentCardVariantProvider variant="bento">
    <div id={id} className="min-w-0">
      <div className="mb-4">
        <BentoHero
          id={`${id}-hero`}
          titleRef={props.titleRef}
          ticket={ticket}
          statusOptions={props.statusOptions}
          priorityOptions={props.priorityOptions}
          boardOptions={props.boardOptions}
          agentOptions={props.agentOptions}
          availableAgents={props.availableAgents}
          teams={props.teams}
          additionalAgents={props.additionalAgents}
          onAssignTeam={props.onAssignTeam}
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
          onSelectChange={props.onSelectChange}
          onBatchSelectChange={props.onBatchSelectChange}
          onUpdateDescription={props.onUpdateDescription}
          responseStateTrackingEnabled={props.responseStateTrackingEnabled}
          hideSlaStatus={props.hideSlaStatus || !capabilities.sla}
          workflowLocked={props.workflowLocked}
          onOpenAllFields={props.onOpenAllFields}
          tags={props.tags}
          onTagsChange={capabilities.tags ? props.onTagsChange : undefined}
          heroMeta={props.heroMeta}
          customerLabel={[props.contactInfo?.full_name, props.client?.client_name].filter(Boolean).join(' · ') || null}
          timerControl={!props.hideTimeEntry && ticketId ? (
            <TicketStopwatchControls
              id={`${id}-hero-timer`}
              ticketId={ticketId}
              variant="chip"
              enabled={resolveBoardStopwatchEnabled(props.isLiveTicketTimerEnabled)}
              timeDescription={props.timeDescription}
              onTimeDescriptionChange={props.onTimeDescriptionChange}
              masterTicketId={ticket.master_ticket_id ?? null}
              onTimeEntryLogged={props.onTimeEntryLogged}
            />
          ) : undefined}
          moreActions={props.heroMoreActions}
          onResolveAndClose={props.onResolveAndClose}
          resolveAndCloseDisabled={props.resolveAndCloseDisabled}
          liveHighlightedFields={props.liveHighlightedFields}
          liveFrozenFields={props.liveFrozenFields}
          liveFieldConflicts={props.liveFieldConflicts}
          onKeepLiveConflict={props.onKeepLiveConflict}
          onTakeLiveConflict={props.onTakeLiveConflict}
          liveEditingUsers={props.liveEditingUsers}
          onLiveEditingFieldChange={props.onLiveEditingFieldChange}
          onLiveDirtyFieldsChange={props.onLiveDirtyFieldsChange}
          createdByUser={props.createdByUser}
          userId={props.userId}
          onClipboardImageUploaded={props.onClipboardImageUploaded}
          uploadTicketAttachmentAction={props.uploadTicketAttachmentAction}
          deleteDraftTicketAttachmentImagesAction={props.deleteDraftTicketAttachmentImagesAction}
          resolveTicketAttachmentViewUrl={props.resolveTicketAttachmentViewUrl}
        />
      </div>
      <BentoCollapseEmptyTiles>
      <BentoBoard
        id={`${id}-board`}
        tiles={sideTiles}
        groups={[
          { key: 'customer', label: t('bento.groups.customer', 'Customer') },
          { key: 'work', label: t('bento.groups.work', 'Work') },
          { key: 'who', label: t('bento.groups.who', 'People') },
          { key: 'linked', label: t('bento.groups.linked', 'Linked items') },
        ]}
        breakpoints={{ medium: 760, wide: 1440 }}
        emptyShelfLabel={t('bento.groups.empty', 'Nothing here yet')}
        narrowTabs={{ main: t('bento.board.conversation', 'Conversation'), side: t('bento.board.details', 'Details') }}
        main={
          <Suspense
            fallback={
              <BentoTileSkeleton
                id={`${id}-timeline-tile-loading`}
                title={t('bento.tiles.timeline', 'Timeline')}
                lines={4}
              />
            }
          >
          <BentoTimelineTile
            id={`${id}-timeline-tile`}
            ticketId={ticketId}
            conversations={props.conversations}
            userMap={props.userMap}
            contactMap={props.contactMap}
            contactFirstName={props.contactInfo?.full_name?.split(' ')[0] ?? null}
            ticketCreatedAt={(ticket.entered_at as unknown as string) ?? null}
            refreshKey={props.timelineRefreshKey}
            initialOrder={props.timelineInitialOrder}
            editorKey={props.editorKey}
            defaultReplyInternal={props.defaultReplyInternal}
            isSubmitting={props.isSubmitting}
            onNewCommentContentChange={props.onNewCommentContentChange}
            onAddNewComment={props.onAddNewComment}
            closedStatusOptions={props.closedStatusOptions}
            onAddReplyComment={props.onAddReplyComment}
            currentUser={props.currentUser}
            isEditing={props.isEditing}
            currentComment={props.currentComment}
            onContentChange={props.onContentChange}
            onSaveComment={props.onSaveComment}
            onCloseEdit={props.onCloseEdit}
            onEditComment={props.onEditComment}
            onDeleteComment={props.onDeleteComment}
            reactionRefreshVersion={props.reactionRefreshVersion}
            canViewCommentMetadataDebug={props.canViewCommentMetadataDebug}
            onClipboardImageUploaded={props.onClipboardImageUploaded}
            uploadTicketAttachmentAction={props.uploadTicketAttachmentAction}
            deleteDraftTicketAttachmentImagesAction={props.deleteDraftTicketAttachmentImagesAction}
            resolveTicketAttachmentViewUrl={props.resolveTicketAttachmentViewUrl}
            initialEntries={props.bentoStreams?.timelineEntries}
            initialReactions={props.bentoStreams?.commentReactions}
            allowEmailRecipients
            clientId={ticket.client_id ?? null}
          />
          </Suspense>
        }
      />
      </BentoCollapseEmptyTiles>
      {sideTileDialogs}
    </div>
    </ContentCardVariantProvider>
  );
}

export default TicketBentoLayout;
