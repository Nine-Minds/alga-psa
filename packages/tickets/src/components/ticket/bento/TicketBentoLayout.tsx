'use client';

import React, { Suspense } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { FileText, User, Play, Pause, StopCircle, Clock, Users, X, Pencil } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
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
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile, BentoTileEmpty, BentoTileSkeleton } from './BentoTile';
import { BentoHero } from './BentoHero';
import { BentoTimelineTile } from './BentoTimelineTile';
import { SlaClocksTile } from './SlaClocksTile';
import { NextVisitTile, CallsEmailsTile, BillingTile } from './dataTiles';
import { TimeLoggedSummary } from './TimeLoggedSummary';
import type { TicketSlaFields } from './slaClocks';

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export interface TicketBentoLayoutProps {
  id: string;
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
  responseStateTrackingEnabled?: boolean;
  hideSlaStatus?: boolean;
  workflowLocked?: boolean;
  onOpenAllFields: () => void;
  tags?: any[];
  onTagsChange?: (tags: any[]) => void;
  taskActions?: React.ReactNode;
  liveHighlightedFields?: string[];
  liveFrozenFields?: string[];
  /** Opens the agent schedule drawer (global drawer system). */
  onAgentClick?: (userId: string) => void;
  /** Client locations for resolving the ticket's location display line. */
  locations?: { location_id: string; location_name?: string | null; address_line1?: string | null; city?: string | null }[];
  // Timeline
  conversations: IComment[];
  userMap: Record<string, CommentUserAuthor>;
  contactMap: Record<string, CommentContactAuthor>;
  timelineRefreshKey: number;
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
  const { enabled: billingEnabled } = useFeatureFlag('billing-enabled');
  const [requestExpanded, setRequestExpanded] = React.useState(false);

  const ticketLocation = React.useMemo(() => {
    if (!ticket.location_id || !props.locations) return null;
    const location = props.locations.find((loc) => loc.location_id === ticket.location_id);
    if (!location) return null;
    return [location.location_name, location.address_line1, location.city].filter(Boolean).join(', ');
  }, [ticket.location_id, props.locations]);

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
            <div className={`text-sm ${requestExpanded ? '' : 'max-h-40 overflow-hidden'}`}>
              <RichTextViewer id={`${id}-request-description`} content={descriptionBlocks} />
            </div>
            {descriptionBlocks.length > 3 ? (
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

      <BentoTile id={`${id}-contact-tile`} title={t('bento.tiles.contact', 'Contact')} icon={<User className="h-4 w-4" />}>
        {props.contactInfo || props.client ? (
          <div className="space-y-1.5 text-sm">
            {props.contactInfo ? (
              <button
                id={`${id}-contact-open`}
                type="button"
                className="font-medium text-[rgb(var(--color-primary-600))] hover:underline text-left"
                onClick={props.onContactClick}
              >
                {props.contactInfo.full_name}
              </button>
            ) : (
              <BentoTileEmpty id={`${id}-contact-none`}>{t('bento.tiles.noContactOnTicket', 'No contact on this ticket')}</BentoTileEmpty>
            )}
            {props.contactInfo?.email ? (
              <div className="text-[rgb(var(--color-text-600))] truncate">{props.contactInfo.email}</div>
            ) : null}
            {(props.contactInfo as { phone_number?: string } | null)?.phone_number ? (
              <div className="text-[rgb(var(--color-text-600))] truncate">
                {(props.contactInfo as { phone_number?: string }).phone_number}
              </div>
            ) : null}
            {ticketLocation ? (
              <div className="text-[rgb(var(--color-text-500))] text-xs truncate">{ticketLocation}</div>
            ) : null}
            {props.client ? (
              <div className="pt-1 border-t border-[rgb(var(--color-border-100))]">
                <span className="text-xs text-[rgb(var(--color-text-400))]">{t('bento.tiles.client', 'Client')}</span>{' '}
                <button
                  id={`${id}-client-open`}
                  type="button"
                  className="font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                  onClick={props.onClientClick}
                >
                  {props.client.client_name}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <BentoTileEmpty id={`${id}-contact-empty`}>{t('bento.tiles.noContactOnTicket', 'No contact on this ticket')}</BentoTileEmpty>
        )}
      </BentoTile>

      {props.associatedAssets ? (
        <div id={`${id}-assets-container`}>{props.associatedAssets}</div>
      ) : null}

      <Suspense fallback={<BentoTileSkeleton id={`${id}-next-visit-tile-loading`} title={t('bento.tiles.nextVisit', 'Next visit')} />}>
        <NextVisitTile
          id={`${id}-next-visit-tile`}
          ticketId={ticketId}
          initialData={props.bentoStreams?.scheduleEntries}
        />
      </Suspense>
      <Suspense fallback={<BentoTileSkeleton id={`${id}-calls-emails-tile-loading`} title={t('bento.tiles.callsAndEmails', 'Calls and emails')} />}>
        <CallsEmailsTile
          id={`${id}-calls-emails-tile`}
          ticketId={ticketId}
          viewAllHref={ticket.contact_name_id ? `/msp/contacts/${ticket.contact_name_id}/activity` : undefined}
          initialData={props.bentoStreams?.interactions}
        />
      </Suspense>
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
                  aria-disabled={props.isTimerLocked}
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

  const teamTile = (
    <BentoTile
      id={`${id}-team-tile`}
      title={t('bento.tiles.teamAndWatchers', 'Team and watchers')}
      icon={<Users className="h-4 w-4" />}
    >
      <div className="space-y-2 mb-3">
        {props.additionalAgents.length > 0 ? (
          props.additionalAgents.map((agent) => {
            const agentUser = props.availableAgents.find((user) => user.user_id === agent.additional_user_id);
            const name = agentUser ? `${agentUser.first_name} ${agentUser.last_name}` : t('bento.tiles.agentFallback', 'Agent');
            return (
              <div key={agent.assignment_id ?? agent.additional_user_id ?? name} className="flex items-center gap-2 text-sm">
                <UserAvatar userId={agentUser?.user_id ?? ''} userName={name} avatarUrl={null} size="xs" />
                {props.onAgentClick && agent.additional_user_id ? (
                  <button
                    id={`${id}-team-agent-${agent.additional_user_id}`}
                    type="button"
                    className="text-[rgb(var(--color-text-700))] truncate hover:underline text-left"
                    onClick={() => props.onAgentClick?.(agent.additional_user_id!)}
                  >
                    {name}
                  </button>
                ) : (
                  <span className="text-[rgb(var(--color-text-700))] truncate">{name}</span>
                )}
                <button
                  id={`${id}-team-remove-${agent.additional_user_id}`}
                  type="button"
                  aria-label={t('bento.tiles.removeAgent', 'Remove {{name}}', { name })}
                  className="ml-auto text-[rgb(var(--color-text-400))] hover:text-red-600 dark:hover:text-red-400"
                  onClick={() => agent.assignment_id && props.onRemoveAgent(agent.assignment_id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        ) : (
          <BentoTileEmpty id={`${id}-team-empty`}>{t('bento.tiles.noAdditionalAgents', 'No additional agents')}</BentoTileEmpty>
        )}
        <CustomSelect
          id={`${id}-team-add-select`}
          value=""
          placeholder={t('bento.tiles.addAgent', 'Add an agent…')}
          options={props.availableAgents
            .filter(
              (user) =>
                user.user_id !== ticket.assigned_to &&
                !props.additionalAgents.some((agent) => agent.additional_user_id === user.user_id),
            )
            .map((user) => ({ value: user.user_id, label: `${user.first_name} ${user.last_name}` }))}
          onValueChange={(value: string) => value && props.onAddAgent(value)}
          className="!w-full"
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

      {billingEnabled ? (
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
          ticket={ticket}
          statusOptions={props.statusOptions}
          priorityOptions={props.priorityOptions}
          boardOptions={props.boardOptions}
          agentOptions={props.agentOptions}
          onSelectChange={props.onSelectChange}
          responseStateTrackingEnabled={props.responseStateTrackingEnabled}
          hideSlaStatus={props.hideSlaStatus}
          workflowLocked={props.workflowLocked}
          onOpenAllFields={props.onOpenAllFields}
          tags={props.tags}
          onTagsChange={props.onTagsChange}
          taskActions={props.taskActions}
          liveHighlightedFields={props.liveHighlightedFields}
          liveFrozenFields={props.liveFrozenFields}
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
