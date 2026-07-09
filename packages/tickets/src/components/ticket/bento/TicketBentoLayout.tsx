'use client';

import React, { Suspense, useRef } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { FileText, User, Play, Pause, StopCircle, Clock, Users, Pencil } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import ContactAvatar from '@alga-psa/ui/components/ContactAvatar';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { RichTextViewer } from '@alga-psa/ui/editor';
import { ContentCardVariantProvider } from '@alga-psa/ui/components';
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
import { parseTicketRichTextContent } from '../../../lib/ticketRichText';
import type { CommentUserAuthor, CommentContactAuthor } from '../../../lib/commentAuthorResolution';
import TicketChecklistSection from './../TicketChecklistSection';
import { DocumentsTile } from './DocumentsTile';
import type { TicketScreenBootstrap } from '../../../lib/ticketScreenBootstrap';
import TicketTimeEntries from './../TicketTimeEntries';
import TicketMaterialsCard from './../TicketMaterialsCard';
import TicketWatchListCard from './../TicketWatchListCard';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { useQuickAddClient } from '@alga-psa/ui/context';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile, BentoTileEmpty, BentoTileSkeleton } from '@alga-psa/ui/components/bento/BentoTile';
import { BentoHero } from './BentoHero';
import { BentoTimelineTile } from './BentoTimelineTile';
import { SlaClocksTile } from './SlaClocksTile';
import { NextVisitTile, AppointmentRequestsTile, CallsEmailsTile, BillingTile } from './dataTiles';
import { TimeLoggedSummary } from './TimeLoggedSummary';
import { useTeamAvatarUrl } from './useTeamAvatarUrl';
import type { TicketSlaFields } from './slaClocks';
import type { TicketLiveConflictState } from '../ticketLiveFields';

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

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
  /** Coalesced multi-field hero save (debounced batch); forwarded to BentoHero. */
  onBatchSelectChange?: (changes: Record<string, string | null>) => Promise<void> | void;
  responseStateTrackingEnabled?: boolean;
  hideSlaStatus?: boolean;
  /** Hides the billing rollup tile (AlgaDesk has no billing surface). */
  hideBilling?: boolean;
  /** Hides the Next visit / Appointment requests tiles (AlgaDesk has no scheduling surface). */
  hideScheduling?: boolean;
  workflowLocked?: boolean;
  onOpenAllFields: () => void;
  tags?: any[];
  onTagsChange?: (tags: any[]) => void;
  taskActions?: React.ReactNode;
  liveHighlightedFields?: string[];
  liveFrozenFields?: string[];
  liveFieldConflicts?: Partial<Record<string, TicketLiveConflictState>>;
  onKeepLiveConflict?: (field: string) => void;
  onTakeLiveConflict?: (field: string) => void;
  liveEditingUsers?: Partial<Record<string, string[]>>;
  onLiveEditingFieldChange?: (field: string | null) => void;
  /** Opens the agent schedule drawer (global drawer system). */
  onAgentClick?: (userId: string) => void;
  /** Client locations for resolving the ticket's location display line. */
  locations?: { location_id: string; location_name?: string | null; address_line1?: string | null; city?: string | null }[];
  /** Opens the scheduler drawer pre-scoped to this ticket (global drawer system). */
  onScheduleVisit?: () => void;
  /** Bumped by the parent after a visit is scheduled so the "Next visit" tile refetches. */
  nextVisitRefreshKey?: number;
  // Timeline
  conversations: IComment[];
  userMap: Record<string, CommentUserAuthor>;
  contactMap: Record<string, CommentContactAuthor>;
  timelineRefreshKey: number | string;
  timelineInitialOrder: 'asc' | 'desc';
  editorKey: number;
  isSubmitting?: boolean;
  onNewCommentContentChange: (content: PartialBlock[]) => void;
  onAddNewComment: (isInternal: boolean, isResolution: boolean) => Promise<boolean>;
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
  onAddReplyComment?: (content: PartialBlock[], parentCommentId: string, isInternal: boolean) => Promise<boolean>;
  /**
   * Server-started data promises from the RSC page. Tiles resolve them via
   * React use() behind <Suspense> skeletons — zero fetch-on-mount requests.
   */
  bentoStreams?: NonNullable<TicketScreenBootstrap['streams']>;
  // Request / contact
  createdByUser?: IUser | null;
  contactInfo?: IContact | null;
  client?: IClient | null;
  onContactClick: () => void;
  onClientClick: () => void;
  /** Clients list, used to scope the quick-add-contact modal. */
  clients?: IClient[];
  /** Persists a contact change (or clear, when null). Enables inline contact editing on the tile — the picker pool is the existing `contacts` prop. */
  onChangeContact?: (contactId: string | null) => void;
  /** Repoints the ticket to a different client (resets contact + location). Enables the inline ClientPicker on the tile. */
  onChangeClient?: (clientId: string) => void;
  // Checklist
  checklistItems: any[];
  onChecklistItemsChanged: (items: any[]) => void;
  // Timer / time entries
  hideTimeEntry?: boolean;
  isLiveTicketTimerEnabled?: boolean;
  elapsedTime: number;
  isRunning: boolean;
  isTimerLocked?: boolean;
  timeDescription: string;
  onTimeDescriptionChange: (value: string) => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onAddTimeEntry: () => void;
  userId?: string;
  dateTimeFormat?: string;
  timeEntriesRefreshKey?: number;
  onEditTimeEntry?: (entry: any) => void;
  onDeleteTimeEntry?: (entry: any) => void;
  renderIntervalManagement?: (args: { ticketId: string; userId: string }) => React.ReactNode;
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
  onUpdateWatchList?: (watchList: any[]) => Promise<boolean>;
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

/**
 * The "Grid" ticket layout: hero band on top, unified timeline as the center
 * spine, who/what tiles on the left, state tiles on the right. Every tile is
 * fed by the same state and handlers TicketDetails already owns — this
 * component arranges, it does not own writes.
 */
export function TicketBentoLayout(props: TicketBentoLayoutProps) {
  const { id, ticket } = props;
  const { t } = useTranslation('features/tickets');
  const ticketId = ticket.ticket_id ?? '';
  const [requestExpanded, setRequestExpanded] = React.useState(false);
  // Guards against re-entrant add/remove churn on rapid multi-select changes.
  const isProcessingAgentsRef = useRef(false);

  const ticketLocation = React.useMemo(() => {
    if (!ticket.location_id || !props.locations) return null;
    const location = props.locations.find((loc) => loc.location_id === ticket.location_id);
    if (!location) return null;
    return [location.location_name, location.address_line1, location.city].filter(Boolean).join(', ');
  }, [ticket.location_id, props.locations]);

  const contactPhone = props.contactInfo
    ? props.contactInfo.default_phone_number ?? props.contactInfo.phone_numbers?.[0]?.phone_number ?? null
    : null;

  // Inline contact editing: the tile picks from the same client-scoped contacts
  // the all-fields drawer uses, and quick-add attaches a brand-new one. Editing
  // is only offered when TicketDetails wired a change handler and the ticket has
  // a client to scope the picker/quick-add to.
  const { renderQuickAddContact, renderQuickAddInteraction } = useQuickAddClient();
  const effectiveClientId = props.client?.client_id ?? ticket.client_id ?? undefined;
  const canEditContact = Boolean(props.onChangeContact) && Boolean(effectiveClientId);
  const [contactEditOpen, setContactEditOpen] = React.useState(false);
  const [selectedContactId, setSelectedContactId] = React.useState<string | null>(null);
  const [pickerContacts, setPickerContacts] = React.useState<IContact[]>(props.contacts ?? []);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = React.useState(false);

  // Repoint the ticket to a different client. Mirrors the legacy Contact Info
  // card: an inline ClientPicker that, on save, resets contact + location
  // (handled by the wired onChangeClient handler in TicketDetails).
  const canChangeClient = Boolean(props.onChangeClient);
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
  const canLogInteraction = Boolean(effectiveClientId);
  const [isLogInteractionOpen, setIsLogInteractionOpen] = React.useState(false);
  const [interactionRefreshKey, setInteractionRefreshKey] = React.useState(0);
  const logInteractionContactId = props.contactInfo?.contact_name_id ?? ticket.contact_name_id ?? null;

  React.useEffect(() => {
    setPickerContacts(props.contacts ?? []);
  }, [props.contacts]);

  const openContactEditor = React.useCallback(() => {
    setSelectedContactId(props.contactInfo?.contact_name_id ?? null);
    setContactEditOpen(true);
  }, [props.contactInfo?.contact_name_id]);

  const requestBodyRef = React.useRef<HTMLDivElement>(null);
  const [requestOverflows, setRequestOverflows] = React.useState(false);

  const descriptionBlocks = React.useMemo(
    () => parseTicketRichTextContent(ticket.attributes?.description as string | object | undefined),
    [ticket.attributes?.description],
  );
  const hasDescription = React.useMemo(
    () =>
      descriptionBlocks.some((block) =>
        Array.isArray((block as { content?: unknown }).content)
          ? ((block as { content: unknown[] }).content.length > 0)
          : Boolean((block as { content?: unknown }).content),
      ),
    [descriptionBlocks],
  );

  React.useEffect(() => {
    const el = requestBodyRef.current;
    if (!el || requestExpanded) return;
    setRequestOverflows(el.scrollHeight > el.clientHeight + 4);
  }, [descriptionBlocks, requestExpanded, hasDescription]);

  const leftRail = (
    <div className="space-y-4 min-w-0">
      <BentoTile
        id={`${id}-request-tile`}
        title={t('bento.tiles.request', 'Request')}
        icon={<FileText className="h-4 w-4" />}
        action={
          <button
            id={`${id}-request-edit`}
            type="button"
            aria-label={t('bento.tiles.editDescription', 'Edit description')}
            className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-700))]"
            onClick={props.onOpenAllFields}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        }
      >
        {hasDescription ? (
          <>
            <div ref={requestBodyRef} className={`text-sm ${requestExpanded ? '' : 'max-h-40 overflow-hidden'}`}>
              <RichTextViewer id={`${id}-request-description`} content={descriptionBlocks} />
            </div>
            {requestOverflows || requestExpanded ? (
              <button
                id={`${id}-request-expand`}
                type="button"
                className="text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-1 self-start"
                onClick={() => setRequestExpanded((value) => !value)}
              >
                {requestExpanded ? t('bento.tiles.showLess', 'Show less') : t('bento.tiles.showMore', 'Show more')}
              </button>
            ) : null}
          </>
        ) : (
          <BentoTileEmpty id={`${id}-request-empty`}>{t('bento.tiles.noDescriptionYet', 'No description yet')}</BentoTileEmpty>
        )}
        <p className="text-xs text-[rgb(var(--color-text-400))] mt-2">
          {props.createdByUser
            ? t('bento.tiles.openedBy', 'Opened by {{name}}', { name: `${props.createdByUser.first_name} ${props.createdByUser.last_name}` })
            : t('bento.tiles.opened', 'Opened')}
          {ticket.source ? ` · ${t('bento.tiles.viaSource', 'via {{source}}', { source: String(ticket.source).replace(/_/g, ' ') })}` : ''}
        </p>
      </BentoTile>

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
              <div className="flex items-center gap-2 min-w-0">
                <ContactAvatar
                  contactId={props.contactInfo.contact_name_id || ''}
                  contactName={props.contactInfo.full_name || ''}
                  avatarUrl={props.contactInfo.avatarUrl ?? null}
                  size="sm"
                />
                <button
                  id={`${id}-contact-open`}
                  type="button"
                  className="font-medium text-[rgb(var(--color-primary-600))] hover:underline text-left truncate"
                  onClick={props.onContactClick}
                >
                  {props.contactInfo.full_name}
                </button>
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
              <BentoTileEmpty id={`${id}-contact-none`}>{t('bento.tiles.noContactOnTicket', 'No contact on this ticket')}</BentoTileEmpty>
            )}
            {props.contactInfo?.email ? (
              <div className="text-[rgb(var(--color-text-600))] truncate">{props.contactInfo.email}</div>
            ) : null}
            {contactPhone ? (
              <div className="text-[rgb(var(--color-text-600))] truncate">{contactPhone}</div>
            ) : null}
            {ticketLocation ? (
              <div className="text-[rgb(var(--color-text-500))] text-xs truncate">{ticketLocation}</div>
            ) : null}
            {props.client ? (
              <div className="pt-1 border-t border-[rgb(var(--color-border-100))]">
                <div className="flex items-center gap-2">
                  <ClientAvatar
                    clientId={props.client.client_id}
                    clientName={props.client.client_name}
                    logoUrl={props.client.logoUrl ?? null}
                    size="sm"
                  />
                  <span className="text-xs text-[rgb(var(--color-text-400))]">{t('bento.tiles.client', 'Client')}</span>{' '}
                  <button
                    id={`${id}-client-open`}
                    type="button"
                    className="font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                    onClick={props.onClientClick}
                  >
                    {props.client.client_name}
                  </button>
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
          </div>
        ) : (
          <div className="space-y-1">
            <BentoTileEmpty id={`${id}-contact-empty`}>{t('bento.tiles.noContactOnTicket', 'No contact on this ticket')}</BentoTileEmpty>
            {props.onChangeContact && !effectiveClientId ? (
              <p className="text-xs text-[rgb(var(--color-text-400))]">
                {t('bento.tiles.setClientToAddContact', 'Set a client first to add a contact')}
              </p>
            ) : null}
          </div>
        )}
      </BentoTile>
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

      {props.associatedAssets ? (
        <div id={`${id}-assets-container`}>{props.associatedAssets}</div>
      ) : null}

      {!props.hideScheduling ? (
        <>
          <Suspense fallback={<BentoTileSkeleton id={`${id}-next-visit-tile-loading`} title={t('bento.tiles.nextVisit', 'Next visit')} />}>
            <NextVisitTile
              id={`${id}-next-visit-tile`}
              ticketId={ticketId}
              refreshKey={props.nextVisitRefreshKey}
              initialData={props.bentoStreams?.scheduleEntries}
              onScheduleVisit={props.onScheduleVisit}
            />
          </Suspense>
          <AppointmentRequestsTile
            id={`${id}-appointment-requests-tile`}
            ticketId={ticketId}
            refreshKey={props.nextVisitRefreshKey}
          />
        </>
      ) : null}
      <Suspense fallback={<BentoTileSkeleton id={`${id}-calls-emails-tile-loading`} title={t('bento.tiles.callsAndEmails', 'Calls and emails')} />}>
        <CallsEmailsTile
          id={`${id}-calls-emails-tile`}
          ticketId={ticketId}
          refreshKey={interactionRefreshKey}
          viewAllHref={ticket.contact_name_id ? `/msp/contacts/${ticket.contact_name_id}/activity` : undefined}
          onLogInteraction={canLogInteraction ? () => setIsLogInteractionOpen(true) : undefined}
          initialData={props.bentoStreams?.interactions}
        />
      </Suspense>
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
    </div>
  );

  const timerTile = !props.hideTimeEntry ? (
    <BentoTile id={`${id}-time-tile`} title={t('bento.tiles.timeLogged', 'Time logged')} icon={<Clock className="h-4 w-4" />}>
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
      {props.isLiveTicketTimerEnabled ? (
        <div className="mb-3">
          <div className="flex items-center justify-between rounded-md bg-[rgb(var(--color-border-100))] px-3 py-2 font-mono text-xl text-[rgb(var(--color-text-900))]">
            <span id={`${id}-timer-clock`}>{formatElapsed(props.elapsedTime)}</span>
            <div className="flex items-center gap-1">
              {!props.isRunning ? (
                <Button
                  {...withDataAutomationId({ id: `${id}-timer-start` })}
                  variant="ghost"
                  size="sm"
                  onClick={props.onStart}
                  aria-label={t('bento.tiles.startTimer', 'Start timer')}
                  title={props.isTimerLocked ? t('bento.tiles.timerLockedHint', 'Another timer is already running') : undefined}
                  className={props.isTimerLocked ? 'opacity-60' : ''}
                >
                  <Play className="h-4 w-4" />
                </Button>
              ) : (
                <Button {...withDataAutomationId({ id: `${id}-timer-pause` })} variant="ghost" size="sm" onClick={props.onPause}>
                  <Pause className="h-4 w-4" />
                </Button>
              )}
              <Button {...withDataAutomationId({ id: `${id}-timer-stop` })} variant="ghost" size="sm" onClick={props.onStop}>
                <StopCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="mt-2">
            <Label htmlFor={`${id}-timer-description`}>{t('bento.tiles.workDescription', 'Work description')}</Label>
            <Input
              id={`${id}-timer-description`}
              value={props.timeDescription}
              onChange={(event) => props.onTimeDescriptionChange(event.target.value)}
              placeholder={t('bento.tiles.whatAreYouWorkingOn', 'What are you working on?')}
              containerClassName="mb-0"
            />
          </div>
        </div>
      ) : null}

      <Button
        {...withDataAutomationId({ id: `${id}-add-time-entry` })}
        type="button"
        className="w-full mb-3"
        onClick={props.onAddTimeEntry}
      >
        {t('bento.tiles.addTimeEntry', 'Add time entry')}
      </Button>

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
            dateTimeFormat={props.dateTimeFormat}
            refreshKey={props.timeEntriesRefreshKey}
            onEditEntry={props.onEditTimeEntry}
            onDeleteEntry={props.onDeleteTimeEntry}
            initialSummary={props.bentoStreams?.timeEntries}
          />
        </Suspense>
      ) : null}

      {props.isLiveTicketTimerEnabled && ticketId && props.userId && props.renderIntervalManagement ? (
        <div className="mt-2 border-t border-[rgb(var(--color-border-100))] pt-3" {...withDataAutomationId({ id: `${id}-interval-management` })}>
          <h4 className="text-xs font-semibold text-[rgb(var(--color-text-500))] mb-2">{t('bento.tiles.trackedIntervals', 'Tracked intervals')}</h4>
          {props.renderIntervalManagement({ ticketId, userId: props.userId })}
        </div>
      ) : null}
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
        />
      </div>

    </BentoTile>
  );

  const rightRail = (
    // At the lg tier the right rail spans the full width below the timeline,
    // so its tiles flow as a 3-up grid; at xl it becomes the stacked rail.
    <div className="min-w-0 space-y-4 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:items-start xl:block xl:space-y-4">
      {!props.hideSlaStatus ? <SlaClocksTile id={`${id}-sla-tile`} ticket={ticket} initialPolicyName={props.bentoStreams?.slaPolicyName} /> : null}

      {/* These sections ship their own ContentCard chrome; the surrounding
          ContentCardVariantProvider restyles it to match the bento tiles, so
          they render directly (no BentoTile double-wrap). */}
      <TicketChecklistSection
        id={`${id}-checklist-section`}
        ticketId={ticketId}
        initialItems={props.checklistItems}
        onItemsChanged={props.onChecklistItemsChanged}
      />

      {timerTile}

      {!props.hideBilling ? (
        <Suspense fallback={<BentoTileSkeleton id={`${id}-billing-tile-loading`} title={t('bento.tiles.billing', 'Billing')} />}>
          <BillingTile
            id={`${id}-billing-tile`}
            ticketId={ticketId}
            refreshKey={props.timeEntriesRefreshKey}
            initialData={props.bentoStreams?.billingRollup}
          />
        </Suspense>
      ) : null}

      {teamTile}

      <TicketWatchListCard
        id={`${id}-watch-list`}
        attributes={ticket.attributes}
        onUpdateWatchList={props.onUpdateWatchList}
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

      {!props.hideMaterials ? (
        <TicketMaterialsCard id={`${id}-materials`} ticketId={ticketId} clientId={ticket.client_id} initialMaterials={props.bentoStreams?.materials} />
      ) : null}

      {props.surveySummaryCard ? props.surveySummaryCard : null}

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
    </div>
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
          onAgentClick={props.onAgentClick}
          onSelectChange={props.onSelectChange}
          onBatchSelectChange={props.onBatchSelectChange}
          responseStateTrackingEnabled={props.responseStateTrackingEnabled}
          hideSlaStatus={props.hideSlaStatus}
          workflowLocked={props.workflowLocked}
          onOpenAllFields={props.onOpenAllFields}
          tags={props.tags}
          onTagsChange={props.onTagsChange}
          taskActions={props.taskActions}
          liveHighlightedFields={props.liveHighlightedFields}
          liveFrozenFields={props.liveFrozenFields}
          liveFieldConflicts={props.liveFieldConflicts}
          onKeepLiveConflict={props.onKeepLiveConflict}
          onTakeLiveConflict={props.onTakeLiveConflict}
          liveEditingUsers={props.liveEditingUsers}
          onLiveEditingFieldChange={props.onLiveEditingFieldChange}
        />
      </div>
      {/* Mobile: timeline first, then state tiles (SLA/checklist lead the right
          rail), then who/what tiles. 1024–1279px: 4/8 with the right rail
          flowing below. ≥1280px: the full 3/6/3 bento. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="order-3 lg:order-1 lg:col-span-4 xl:col-span-3">{leftRail}</div>
        <div className="order-1 lg:order-2 lg:col-span-8 xl:col-span-6 min-w-0">
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
            isSubmitting={props.isSubmitting}
            onNewCommentContentChange={props.onNewCommentContentChange}
            onAddNewComment={props.onAddNewComment}
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
          />
          </Suspense>
        </div>
        <div className="order-2 lg:order-3 lg:col-span-12 xl:col-span-3">{rightRail}</div>
      </div>
    </div>
    </ContentCardVariantProvider>
  );
}

export default TicketBentoLayout;
