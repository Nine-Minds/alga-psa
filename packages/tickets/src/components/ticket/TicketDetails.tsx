'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getUserTimeZone } from '@alga-psa/core';
import { deriveWorkReason } from '../../lib/deriveWorkReason';
import { formatTicketDateTime, formatTicketRelativeToNow } from '../../lib/ticketDateTimeFormat';
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
import { DeleteEntityDialog } from "@alga-psa/ui/components/DeleteEntityDialog";
import type { DeletionValidationResult } from "@alga-psa/types";
import {
    ITicket,
    IComment,
    ITimeSheet,
    ITimePeriod,
    ITimePeriodView,
    ITimeEntry,
    IClient,
    IClientLocation,
    IContact,
    IUser,
    IUserWithRoles,
    ITeam,
    ITicketResource,
    ITicketCategory
} from "@alga-psa/types";
import { ITag } from "@alga-psa/types";
import { TagManager } from "@alga-psa/tags/components";
import { isTagActionError } from "@alga-psa/tags/actions";
import { useTags } from '@alga-psa/tags/context';
import TicketInfo from "./TicketInfo";
import TicketNotificationSuppressionControl, { type TicketNotificationSuppressionValue } from './TicketNotificationSuppressionControl';
import TicketProperties from "./TicketProperties";
import TicketDocumentsSection from "./TicketDocumentsSection";
import { TicketCredentialsSection } from "./TicketCredentialsSection";
import { TicketExternalLinksSection } from "./TicketExternalLinksSection";
import TicketEmailNotifications from "./TicketEmailNotifications";
import TicketConversation from "./TicketConversation";
import type { CommentEmailRecipientsPayload } from "./CommentEmailRecipientsControl";
import { TicketActivityTimeline } from "./TicketActivityTimeline";
import { useInboundEmailViewPreference } from "../../hooks/useInboundEmailViewPreference";
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import {
    handleError,
    isActionPermissionError,
    isActionMessageError,
    getErrorMessage,
    type ActionMessageError,
    type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useDrawer } from "@alga-psa/ui";
import { useCatalogShortcut } from "@alga-psa/ui/keyboard-shortcuts";
import { useSchedulingCallbacks } from '@alga-psa/ui/context';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { EMPTY_PARTY_DISPLAY_TAGS, type PartyDisplayTags } from '../../lib/partyDisplayTags';
import { usePartyDisplayTags } from './usePartyDisplayTags';
import type { ITicketAutoCloseState } from "../../actions/close-rules/closeRuleActions";
import type { ITicketChecklistItem } from "../../actions/checklists/ticketChecklistActions";
import type { ITicketExternalLinkView } from "../../actions/externalLinks/externalLinkActions";
import type { CloseRuleFailure } from "../../lib/validateTicketClosure";
import { BundleStatusPropagationDialog } from "../BundleStatusPropagationDialog";
import type { BundleStatusPropagationPreview } from "../../lib/ticketBundlePropagation";
import TicketChecklistSection, { summarizeChecklist } from "./TicketChecklistSection";
import { Dialog, DialogContent, DialogFooter } from "@alga-psa/ui/components/Dialog";
import { TextArea } from "@alga-psa/ui/components/TextArea";
import { isTeamActionError } from '@alga-psa/teams/actions';
import AgentScheduleDrawer from "./AgentScheduleDrawer";
import type { WorkItemScheduleContext } from '@alga-psa/ui/context';
import { Button } from "@alga-psa/ui/components/Button";
import Drawer from '@alga-psa/ui/components/Drawer';
import { Input } from "@alga-psa/ui/components/Input";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { Label } from "@alga-psa/ui/components/Label";
import { PresenceBar } from '@alga-psa/ui/presence/PresenceBar';
import { ExternalLink, Printer, Mail, History, Trash2, Copy, MoreHorizontal, LayoutTemplate, Workflow } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@alga-psa/ui/components/DropdownMenu';
import { useTicketTemplatePermissions } from '../templates/useTicketTemplatePermissions';
import { WorkItemType } from "@alga-psa/types";
import { ReflectionContainer } from "@alga-psa/ui/ui-reflection/ReflectionContainer";
import { PartialBlock, StyledText } from '@blocknote/core';
import { hasEditorContent } from '@alga-psa/ui/editor/hasEditorContent';
import { convertBlockNoteToMarkdown } from "@alga-psa/formatting/blocknoteUtils";
import BackNav from '@alga-psa/ui/components/BackNav';
import { ResponseStateBadge, LabelPrintDialog } from '@alga-psa/ui/components';
import TicketNavigation from './TicketNavigation';
import LayoutToggle from './bento/LayoutToggle';
import TicketBentoLayout from './bento/TicketBentoLayout';
import type { TicketDetailLayout } from '../../actions/ticketLayoutPreference';
import TicketOriginBadge from '../TicketOriginBadge';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { useTicketLiveContext } from './TicketLiveProvider';
import type { TicketLiveRemoteUpdate } from '../../hooks/useTicketLive';
import { runTicketRefresh, useTicketDataSource } from './TicketDataSourceContext';
import { resolveTicketFrozenFields, resolveTicketTimeWorkItem } from '../../lib/ticketDataSource';
import { buildTicketTimeEntryContext } from '../../lib/timeEntryContext';
import { getTicketOrigin } from '../../lib/ticketOrigin';
import type { RecurringTicketSource } from '../../lib/recurring/types';
import { buildCreateTicketHref } from '../../lib/createTicketRoute';
import {
    setTicketWatchListOnAttributes,
} from '@shared/lib/tickets/watchList';
import type { AddTicketWatcherInput } from '@shared/services/tickets/ticketWatcherService';
import type { TicketWatchersResult } from '../../actions/ticketWatcherActions';
import type {
    BundleMasterClosedContextActionResult,
    EligibleChildTicket
} from '../../actions/ticketBundleActions';
import { ClosedMasterChoiceFields } from './ClosedMasterChoiceFields';
import { isChildWorkflowLocked } from '../../lib/bundleWorkflowLock';
import type { ClosedMasterChoice } from '../../lib/ticketBundlePolicy';
import {
    resolveCommentReferencedImageDocuments,
    type CommentImageDocumentReference,
} from '../../lib/commentImageDocuments';
import { isBoardLiveTicketTimerEnabled } from '../../lib/boardLiveTicketTimer';
import { hasAdminSettingsViewAccess } from './commentMetadataDebug';
import { hasWorkflowManageAccess, type TicketScreenBootstrap } from '../../lib/ticketScreenBootstrap';
import { normalizeTicketLiveField, type TicketLiveConflictState } from './ticketLiveFields';
import TicketResolutionDialog from './TicketResolutionDialog';
import { persistResolutionComment } from './resolutionCommentPersistence';

interface PendingCommentDelete {
    commentId: string;
    imageDocuments: CommentImageDocumentReference[];
}

const LIVE_UPDATE_REFETCH_DEBOUNCE_MS = 200;
const LIVE_UPDATE_HIGHLIGHT_MS = 600;

const isReturnedActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
    isActionMessageError(value) || isActionPermissionError(value);

const emptyNotificationSuppression = (): TicketNotificationSuppressionValue => ({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
});

const handleTicketActionError = (error: unknown, fallback: string) => {
    if (isReturnedActionError(error)) {
        toast.error(getErrorMessage(error));
        return;
    }
    handleError(error, fallback);
};

interface TicketDetailsProps {
    id?: string; // Made optional to maintain backward compatibility
    initialTicket: ITicket & { tenant: string | undefined };
    initialBundle?: any;
    aggregatedChildClientComments?: any[];
    onClose?: () => void; // Callback when user wants to close the ticket screen
    isInDrawer?: boolean;

    // Pre-fetched data props
    initialComments?: IComment[];
    initialDocuments?: any[];
    initialClient?: IClient | null;
    initialContacts?: IContact[];
    initialContactInfo?: IContact | null;
    /** Chip tags for the requester and client, already filtered to the viewer's audience. */
    initialDisplayTags?: PartyDisplayTags;
    initialCreatedByUser?: IUser | null;
    initialUpdatedByUser?: IUser | null;
    initialBoard?: any;
    initialAdditionalAgents?: ITicketResource[];
    initialAvailableAgents?: IUserWithRoles[];
    initialUserMap?: Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>;
    initialContactMap?: Record<string, { contact_id: string; full_name: string; email?: string; avatarUrl: string | null }>;
    statusOptions?: { value: string; label: string; is_closed?: boolean; className?: string; board_id?: string | null }[];
    agentOptions?: { value: string; label: string }[];
    boardOptions?: { value: string; label: string }[];
    priorityOptions?: { value: string; label: string; color?: string | null; is_from_itil_standard?: boolean }[];
    initialCategories?: ITicketCategory[];
    initialClients?: IClient[];
    initialLocations?: IClientLocation[];
    initialAgentSchedules?: { userId: string; minutes: number }[];

    // Current user (for drawer usage)
    currentUser?: IUser | null;

    // Optimized handlers
    onTicketUpdate?: (
        field: string,
        value: any,
        options?: { propagateToChildren?: boolean }
    ) => Promise<void>;
    onBatchTicketUpdate?: (
        changes: Record<string, unknown>,
        options?: Partial<TicketNotificationSuppressionValue> & { propagateToChildren?: boolean }
    ) => Promise<boolean>;
    onAddComment?: (content: string, isInternal: boolean, isResolution: boolean, closesTicket?: boolean, schedule?: { publishAt: string; timeZone: string } | null, emailRecipients?: CommentEmailRecipientsPayload) => Promise<boolean>;
    onUpdateDescription?: (content: string) => Promise<boolean>;
    /**
     * Additive notification fired after a user edit was saved successfully (field change,
     * batch save, new comment, description edit). Purely informational; hosts use it to
     * refresh data derived from the ticket (e.g. the activities list).
     */
    onSaved?: () => void;
    isSubmitting?: boolean;
    /**
     * Optional injected UI for survey summary (e.g. @alga-psa/surveys TicketSurveySummaryCard).
     * This keeps @alga-psa/tickets from importing other vertical slices directly.
     */
    surveySummaryCard?: React.ReactNode;
    /**
     * Server-gathered startup payload (see ticketScreenBootstrap.ts). When
     * present, the matching mount fetches are skipped — the screen renders
     * entirely from the initial RSC response. Absent (drawer usage, tests),
     * the legacy fetch-on-mount behavior is unchanged.
     */
    bootstrap?: TicketScreenBootstrap;

    /**
     * Optional injected UI for cross-slice composition (e.g. assets associations).
     * This keeps @alga-psa/tickets from importing other vertical slices directly.
     */
    associatedAssets?: React.ReactNode;

    /**
     * Optional injected UI for contact quick view (e.g. @alga-psa/clients ContactDetailsView).
     * If omitted, TicketDetails falls back to a minimal drawer with a link to open the contact page.
     */
    renderContactDetails?: (args: {
        id: string;
        contact: IContact;
        clients: IClient[];
        userId?: string;
    }) => React.ReactNode;

    /**
     * Optional injected UI for creating project tasks from tickets.
     */
    renderCreateProjectTask?: (args: { ticket: ITicket; additionalAgents?: { user_id: string; name: string }[] }) => React.ReactNode;

    /**
     * Optional injected UI for quick-invoicing a ticket (e.g. billing package
     * QuickInvoiceTicketDialog). Keeps @alga-psa/tickets from importing billing.
     */
    renderQuickInvoice?: (args: { ticket: ITicket }) => React.ReactNode;
    renderReceiveEquipment?: (args: { ticket: ITicket }) => React.ReactNode;

    /**
     * Optional injected UI for "Create workflow from ticket" (EE only; the composition layer
     * fills it from the `@alga-psa/workflows/ticket-actions` seam). When absent (CE) or in
     * Alga Desk mode the More menu entry is not rendered.
     */
    renderCreateWorkflowFromTicket?: (args: {
        ticketId: string;
        ticketNumber: string;
        title: string;
        open: boolean;
        onOpenChange: (open: boolean) => void;
    }) => React.ReactNode;

    /**
     * Optional injected UI for client quick view (e.g. @alga-psa/clients ClientDetails).
     * If omitted, TicketDetails falls back to a minimal drawer with a link to open the client page.
     */
    renderClientDetails?: (args: {
        id: string;
        client: IClient;
    }) => React.ReactNode;

    /** AlgaDesk product mode: Duplicate opens the AlgaDesk create form variant. */
    isAlgaDeskMode?: boolean;
    hideSlaStatus?: boolean;
    hideBilling?: boolean;
    hideScheduling?: boolean;
    hideTimeEntry?: boolean;
    hideMaterials?: boolean;
    uploadTicketAttachmentAction?: (
        formData: FormData,
        params: { userId: string; ticketId: string }
    ) => Promise<any>;
    deleteDraftTicketAttachmentImagesAction?: (input: {
        ticketId: string;
        documentIds: string[];
    }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
    resolveTicketAttachmentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
    disableAttachmentFolderSelection?: boolean;
    disableAttachmentSharing?: boolean;
    disableAttachmentLinking?: boolean;
    disableAgentSchedule?: boolean;
}

const EMPTY_DOCUMENTS: NonNullable<TicketDetailsProps['initialDocuments']> = [];

const TicketDetails: React.FC<TicketDetailsProps> = ({
    id = 'ticket-details',
    initialTicket,
    initialBundle = null,
    aggregatedChildClientComments = [],
    onClose,
    isInDrawer = false,
    // Pre-fetched data with defaults
    initialComments = [],
    initialDocuments = EMPTY_DOCUMENTS,
    initialClient = null,
    initialContacts = [],
    initialContactInfo = null,
    initialDisplayTags = EMPTY_PARTY_DISPLAY_TAGS,
    initialCreatedByUser = null,
    initialUpdatedByUser = null,
    initialBoard = null,
    initialAdditionalAgents = [],
    initialAvailableAgents = [],
    initialUserMap = {},
    initialContactMap = {},
    statusOptions = [],
    agentOptions = [],
    boardOptions = [],
    priorityOptions = [],
    initialCategories = [],
    initialClients = [],
    initialLocations = [],
    initialAgentSchedules = [],
    // Current user (for drawer usage)
    currentUser,
    // Optimized handlers
    onTicketUpdate,
    onBatchTicketUpdate,
    onAddComment,
    onUpdateDescription,
    onSaved,
    isSubmitting = false,
    surveySummaryCard,
    bootstrap,
    associatedAssets = null,
    renderContactDetails,
    renderCreateProjectTask,
    renderQuickInvoice,
    renderReceiveEquipment,
    renderCreateWorkflowFromTicket,
    renderClientDetails,
    isAlgaDeskMode = false,
    hideSlaStatus = false,
    hideBilling = false,
    hideScheduling = false,
    hideTimeEntry = false,
    hideMaterials = false,
    uploadTicketAttachmentAction,
    deleteDraftTicketAttachmentImagesAction,
    resolveTicketAttachmentViewUrl,
    disableAttachmentFolderSelection = false,
    disableAttachmentSharing = false,
    disableAttachmentLinking = false,
    disableAgentSchedule = false,
}) => {
    const { t } = useTranslation('features/tickets');
    // Hardcoded English, and a date that followed the browser's locale.
    const { formatDate, locale, dateFormat } = useFormatters();
    const ticketLive = useTicketLiveContext();
    const dataSource = useTicketDataSource();
    const { capabilities } = dataSource;
    const {
        getTicketById, updateTicket, deleteTicket, preCheckDeletion, updateTicketWithCache,
        getRecurringSourceForTicket, findBoardById,
    } = dataSource.ticket;
    const {
        findCommentsByTicketId, findCommentById, createComment, updateComment, deleteComment,
        addTicketCommentWithCache, deleteDraftClipboardImages,
    } = dataSource.comments;
    const { getAllActiveContacts, getContactByContactNameId, getContactsByClient, getClientById, getClientLocations } = dataSource.people;
    const { addTicketResource, getTicketResources, removeTicketResource, assignTeamToTicket, removeTeamFromTicket, getTeamById, getTeams } = dataSource.resources;
    const { addTicketWatchers, setTicketWatcherActive, removeTicketWatcher } = dataSource.watchers;
    const { checkTicketClosure, getTicketAutoCloseState } = dataSource.closeRules;
    const {
        previewBundleStatusPropagationAction, addChildrenToBundleAction, findTicketByNumberAction,
        getBundleMasterClosedContextAction, promoteBundleMasterAction, removeChildFromBundleAction,
        unbundleMasterTicketAction, updateBundleSettingsAction, searchEligibleChildTicketsAction,
    } = dataSource.bundles;
    const { getTicketChecklistItems } = dataSource.checklist;
    const { findTagsByEntityId } = dataSource.tags;
    const {
        getCurrentUserPermissions, getTicketLayoutPreference, setTicketLayoutPreference, getTicketingDisplaySettings,
    } = dataSource.viewer;
    const { data: session } = useSession();
    // Keeps the Text / Email choice on inbound-email bodies a stored per-user
    // preference rather than per-message state.
    useInboundEmailViewPreference();
    const [hasHydrated, setHasHydrated] = useState(false);
    const [isPrintWorkTagOpen, setIsPrintWorkTagOpen] = useState(false);
    const [canViewCommentMetadataDebug, setCanViewCommentMetadataDebug] = useState(
        bootstrap?.canViewCommentMetadataDebug ?? false,
    );
    // Tracks which mount fetches the server bootstrap already satisfied, so the
    // corresponding effects skip their FIRST run only (later dep-driven runs —
    // e.g. checklist on status change — still fetch).
    const [canManageWorkflows, setCanManageWorkflows] = useState(
        bootstrap?.canManageWorkflows ?? false,
    );
    const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
    const bootstrapSkips = useRef({
        permissions: bootstrap?.canViewCommentMetadataDebug != null && bootstrap?.canManageWorkflows != null,
        checklist: bootstrap?.checklistItems != null || bootstrap?.autoCloseState != null,
        layout: bootstrap?.layoutPreference != null,
        teams: bootstrap?.teams != null,
        display: bootstrap?.displaySettings != null,
        tags: bootstrap?.tags != null,
        board: bootstrap != null && initialBoard != null,
        adjacent: bootstrap?.streams?.adjacentTickets != null,
    });
    const { getDocumentByTicketId, deleteDocument } = useDocumentsCrossFeature();
    const router = useRouter();
    const ticketsListHref = dataSource.screen.backHref ?? '/msp/tickets';
    const refreshScreen = useCallback(
        (mode: 'soft' | 'reload' = 'soft') => runTicketRefresh(dataSource, mode, router),
        [dataSource, router],
    );
    // Capability gates: a section the data source cannot back is absent, never a placeholder.
    const effectiveHideSlaStatus = hideSlaStatus || !capabilities.sla;
    const effectiveHideBilling = hideBilling || !capabilities.billing;
    const effectiveHideScheduling = hideScheduling || !capabilities.scheduling;
    const effectiveHideTimeEntry = hideTimeEntry || !capabilities.timeEntry;
    const effectiveHideMaterials = hideMaterials || !capabilities.materials;
    const effectiveSurveySummaryCard = capabilities.survey ? surveySummaryCard : undefined;
    const effectiveAssociatedAssets = capabilities.assets ? associatedAssets : null;
    const effectiveRenderCreateProjectTask = capabilities.createProjectTask ? renderCreateProjectTask : undefined;
    const effectiveRenderQuickInvoice = capabilities.quickInvoice && !effectiveHideBilling ? renderQuickInvoice : undefined;
    // Gates the header "Create template from ticket" item and the template link; server actions are authoritative.
    const templatePermissions = useTicketTemplatePermissions();
    // Gates the header "Create workflow from ticket" item: EE slot present, workflow:manage, not Alga Desk.
    const canCreateWorkflowFromTicket = Boolean(renderCreateWorkflowFromTicket) && capabilities.createWorkflow && canManageWorkflows && !isAlgaDeskMode;
    const searchParams = useSearchParams();

    useEffect(() => {
        setHasHydrated(true);
    }, []);

    useEffect(() => {
        if (bootstrapSkips.current.permissions) {
            bootstrapSkips.current.permissions = false;
            return;
        }
        let cancelled = false;
        void getCurrentUserPermissions().then((perms) => {
            if (!cancelled) {
                setCanViewCommentMetadataDebug(hasAdminSettingsViewAccess(perms));
                setCanManageWorkflows(hasWorkflowManageAccess(perms));
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Use passed currentUser if available (for drawer), otherwise fallback to session
    const userId = currentUser?.user_id || session?.user?.id;
    const tenant = initialTicket.tenant;

    const [ticket, setTicket] = useState(initialTicket);
    const [bundle, setBundle] = useState<any>(capabilities.bundles ? initialBundle : null);
    const [cardTitleVisible, setCardTitleVisible] = useState(true);
    const cardTitleRef = useRef<HTMLHeadingElement>(null);
    const [isEmailNotificationLogsDrawerOpen, setIsEmailNotificationLogsDrawerOpen] = useState(false);
    const [isActivityLogDrawerOpen, setIsActivityLogDrawerOpen] = useState(false);
    const [activityLogRefreshKey, setActivityLogRefreshKey] = useState(0);
    // Single-ticket delete (mirrors the client/contact detail-page delete pattern)
    const [isDeleteTicketDialogOpen, setIsDeleteTicketDialogOpen] = useState(false);

    // Close rules: blocked-close dialog + checklist + auto-close banner state
    const [closeBlockedDialog, setCloseBlockedDialog] = useState<{
        isOpen: boolean;
        statusId: string | null;
        failures: CloseRuleFailure[];
        canOverride: boolean;
        suppression: TicketNotificationSuppressionValue | null;
    }>({ isOpen: false, statusId: null, failures: [], canOverride: false, suppression: null });
    const [closeOverrideReason, setCloseOverrideReason] = useState('');
    const [isSubmittingCloseOverride, setIsSubmittingCloseOverride] = useState(false);
    const [isResolutionCloseDialogOpen, setIsResolutionCloseDialogOpen] = useState(false);
    const [isSubmittingResolutionClose, setIsSubmittingResolutionClose] = useState(false);
    // Flagging an existing comment as the resolution while editing it offers the
    // close the composer's resolution toggle would have done inline. Declining
    // leaves the comment flagged and the status untouched.
    const [resolutionClosePrompt, setResolutionClosePrompt] = useState<{
        isOpen: boolean;
        statusId: string | null;
        suppression: TicketNotificationSuppressionValue;
    }>({ isOpen: false, statusId: null, suppression: emptyNotificationSuppression() });
    const [isSubmittingResolutionClosePrompt, setIsSubmittingResolutionClosePrompt] = useState(false);

    // Bundle status propagation confirmation. The preview is fetched first; when
    // it crosses the open/closed boundary with affected children we suspend the
    // caller on a promise until the operator chooses propagate / master-only /
    // cancel. This keeps the choice in one place for all four status-change sites.
    const [bundlePropagationPreview, setBundlePropagationPreview] = useState<BundleStatusPropagationPreview | null>(null);
    // Separate from the resolve/close-override dialogs' busy flags: the
    // propagation confirm button must be enabled while the operator chooses, so
    // this is armed only once a decision has resolved and the write is in flight.
    const [isSubmittingBundlePropagation, setIsSubmittingBundlePropagation] = useState(false);
    const bundleDecisionResolverRef = useRef<
        ((decision: { proceed: boolean; propagateToChildren?: boolean }) => void) | null
    >(null);

    const resolveBundlePropagationDecision = useCallback(
        (decision: { proceed: boolean; propagateToChildren?: boolean }) => {
            const resolver = bundleDecisionResolverRef.current;
            bundleDecisionResolverRef.current = null;
            setBundlePropagationPreview(null);
            resolver?.(decision);
        },
        [],
    );

    const confirmBundlePropagation = useCallback(
        async (newStatusId: string): Promise<{ proceed: boolean; propagateToChildren?: boolean }> => {
            if (!ticket.ticket_id) return { proceed: true };
            try {
                const preview = await previewBundleStatusPropagationAction({
                    masterTicketId: ticket.ticket_id,
                    newStatusId,
                });
                if (isActionMessageError(preview) || isActionPermissionError(preview)) {
                    return { proceed: true };
                }
                if (preview.crossesBoundary && preview.affectedChildren.length > 0) {
                    return await new Promise<{ proceed: boolean; propagateToChildren?: boolean }>((resolve) => {
                        bundleDecisionResolverRef.current = resolve;
                        setBundlePropagationPreview(preview);
                    });
                }
            } catch (previewError) {
                // Fall through to the write; the server still enforces the choice.
                console.error('Bundle propagation preview failed:', previewError);
            }
            return { proceed: true };
        },
        [ticket.ticket_id],
    );

    const confirmStatusChange = useCallback(
        async (newStatusId: string): Promise<{ proceed: boolean; propagateToChildren?: boolean }> => {
            if (ticket.ticket_id) {
                try {
                    const check = await checkTicketClosure(ticket.ticket_id, newStatusId);
                    if (check.wouldClose && !check.allowed) {
                        setCloseOverrideReason('');
                        setCloseBlockedDialog({
                            isOpen: true,
                            statusId: newStatusId,
                            failures: check.failures,
                            canOverride: check.canOverride,
                            suppression: null,
                        });
                        return { proceed: false };
                    }
                } catch (checkError) {
                    // Fall through to the write; the server still enforces.
                    console.error('Close rules pre-check failed:', checkError);
                }
            }
            return confirmBundlePropagation(newStatusId);
        },
        [confirmBundlePropagation, ticket.ticket_id],
    );

    const [checklistItems, setChecklistItems] = useState<ITicketChecklistItem[] | undefined>(
        bootstrap?.checklistItems ?? undefined,
    );
    const [autoCloseState, setAutoCloseState] = useState<ITicketAutoCloseState | null>(
        bootstrap?.autoCloseState ?? null,
    );

    useEffect(() => {
        if (bootstrapSkips.current.checklist) {
            bootstrapSkips.current.checklist = false;
            return;
        }
        let cancelled = false;
        if (!capabilities.checklist || !ticket.ticket_id) return;
        // LEVERAGE: pattern cancellable-mount-fetch — fetch on mount, drop state and error reporting once cancelled; 3 sites in ticket sections.
        getTicketChecklistItems(ticket.ticket_id)
            .then((items) => { if (!cancelled) setChecklistItems(items); })
            .catch((err) => { if (!cancelled) console.error('Failed to load ticket checklist:', err); });
        getTicketAutoCloseState(ticket.ticket_id)
            .then((state) => { if (!cancelled) setAutoCloseState(state); })
            .catch((err) => { if (!cancelled) console.error('Failed to load auto-close state:', err); });
        return () => { cancelled = true; };
        // Re-check the pending auto-close whenever the status changes — a
        // status move usually cancels or reschedules it. Board, category,
        // subcategory and priority are the checklist auto-apply matchers, so a
        // save that changes them can attach template items server-side.
    }, [
        ticket.ticket_id,
        ticket.status_id,
        ticket.board_id,
        ticket.category_id,
        ticket.subcategory_id,
        ticket.priority_id,
        capabilities.checklist,
    ]);

    // Reason prefill: subcategory name, else category name (same rule as the server provider). The dialog
    // sends an override only if the user edits the field.
    const printWorkReason = useMemo(() => {
        const nameOf = (categoryId?: string | null) =>
            categoryId ? initialCategories.find((c) => c.category_id === categoryId)?.category_name : undefined;
        return deriveWorkReason(nameOf(ticket.subcategory_id), nameOf(ticket.category_id)) ?? '';
    }, [initialCategories, ticket.category_id, ticket.subcategory_id]);

    const checklistSummary = useMemo(
        () => summarizeChecklist(checklistItems ?? []),
        [checklistItems]
    );

    const submitCloseOverride = async () => {
        if (!closeBlockedDialog.statusId || !ticket.ticket_id) return;
        setIsSubmittingCloseOverride(true);
        try {
            // Close rules were already overridden, so only the propagation
            // choice remains before we write.
            const propagationDecision = await confirmBundlePropagation(closeBlockedDialog.statusId);
            if (!propagationDecision.proceed) {
                return;
            }
            setIsSubmittingBundlePropagation(true);
            const result = await updateTicketWithCache(ticket.ticket_id, { status_id: closeBlockedDialog.statusId }, {
                overrideCloseRules: true,
                overrideCloseRulesReason: closeOverrideReason.trim() || null,
                propagateToChildren: propagationDecision.propagateToChildren,
                ...(closeBlockedDialog.suppression?.suppressContactNotifications
                    ? {
                        suppressContactNotifications: true,
                        suppressInternalNotifications: closeBlockedDialog.suppression.suppressInternalNotifications,
                    }
                    : {}),
            });
            if (isReturnedActionError(result)) {
                throw result;
            }
            setTicket((prev: any) => ({ ...prev, status_id: closeBlockedDialog.statusId, response_state: null }));
            setCloseBlockedDialog({ isOpen: false, statusId: null, failures: [], canOverride: false, suppression: null });
            setCloseOverrideReason('');
            toast.success(t('messages.ticketClosed', 'Ticket closed'));
            onSaved?.();
        } catch (error) {
            handleTicketActionError(error, t('messages.closeFailed', 'Failed to close ticket'));
        } finally {
            setIsSubmittingCloseOverride(false);
            setIsSubmittingBundlePropagation(false);
        }
    };
    const [ticketDeleteValidation, setTicketDeleteValidation] = useState<DeletionValidationResult | null>(null);
    const [isTicketDeleteValidating, setIsTicketDeleteValidating] = useState(false);
    const [isTicketDeleteProcessing, setIsTicketDeleteProcessing] = useState(false);
    const [conversations, setConversations] = useState<IComment[]>(initialComments);
    const [documents, setDocuments] = useState<any[]>(initialDocuments);
    // A server refresh can change metadata or access without changing IDs.
    useEffect(() => {
        setDocuments(initialDocuments);
    }, [initialDocuments]);
    const [client, setClient] = useState<IClient | null>(initialClient);
    const [contactInfo, setContactInfo] = useState<IContact | null>(initialContactInfo);
    // The requester or client can be changed in place; the chips follow the new party (see the hook).
    const displayTags = usePartyDisplayTags({
      ticketId: ticket.ticket_id,
      contactId: contactInfo?.contact_name_id,
      clientId: client?.client_id,
      initial: initialDisplayTags,
      onError: (error, retry) => {
        const message = isReturnedActionError(error)
          ? getErrorMessage(error)
          : t('messages.loadPartyTagsFailed', 'Failed to load requester and client tags');
        toast.error(
          <span>
            {message}{' '}
            <button type="button" className="underline" onClick={() => { toast.dismiss(); retry(); }}>
              {t('actions.retry', 'Retry')}
            </button>
          </span>,
          { id: 'ticket-party-tags-failed' },
        );
      },
    });
    const [createdByUser, setCreatedByUser] = useState<IUser | null>(initialCreatedByUser);
    const [updatedByUser, setUpdatedByUser] = useState<IUser | null>(initialUpdatedByUser);

    const closedStatusOptions = useMemo(() => {
        const boardId = ticket.board_id;
        if (!boardId) {
            return [];
        }
        return (statusOptions || [])
            .filter(
                (opt) =>
                    !!opt.is_closed &&
                    opt.board_id === boardId
            )
            .map(({ value, label }) => ({ value, label }));
    }, [statusOptions, ticket.board_id]);
    const currentStatusIsClosed = useMemo(
        () => statusOptions.some((option) => option.value === ticket.status_id && option.is_closed),
        [statusOptions, ticket.status_id],
    );

    const addResolutionComment = useCallback(async (
        resolution: string,
        suppression: TicketNotificationSuppressionValue,
        isInternal: boolean = false,
        emailRecipients?: CommentEmailRecipientsPayload,
    ): Promise<boolean> => {
        const ticketId = ticket.ticket_id;
        if (!ticketId) {
            toast.error(t('messages.closeFailed', 'Failed to close ticket'));
            return false;
        }

        try {
            return await persistResolutionComment({
                persistComment: async () => {
                    const result = await addTicketCommentWithCache(
                        ticketId,
                        resolution,
                        isInternal,
                        true,
                        true,
                        suppression,
                        null,
                        // The close email carries these; see the email
                        // subscriber's closes_ticket handling.
                        emailRecipients,
                    );
                    if (isReturnedActionError(result)) {
                        throw result;
                    }
                },
                refreshComments: async () => {
                    const updatedComments = await findCommentsByTicketId(ticketId);
                    if (isReturnedActionError(updatedComments)) {
                        throw updatedComments;
                    }
                    return updatedComments;
                },
                onCommentsRefreshed: (updatedComments) => {
                    setConversations(updatedComments);
                    setActivityLogRefreshKey((value) => value + 1);
                },
                onRefreshError: (error) => {
                    handleTicketActionError(error, t('messages.loadCommentsFailed', 'Failed to load comments'));
                },
            });
        } catch (error) {
            handleTicketActionError(error, t('messages.addCommentFailed', 'Failed to add comment'));
            return false;
        }
    }, [t, ticket.ticket_id]);

    const [board, setBoard] = useState<any>(initialBoard);
    const [savedBoardId, setSavedBoardId] = useState<string | null>(initialBoard?.board_id ?? initialTicket.board_id ?? null);
    const isLiveTicketTimerEnabled = useMemo(() => isBoardLiveTicketTimerEnabled(board), [board]);
    const [clients, setClients] = useState<IClient[]>(initialClients);
    const [contacts, setContacts] = useState<IContact[]>(initialContacts);
    const [locations, setLocations] = useState<IClientLocation[]>(initialLocations);
    const [showWeekday, setShowWeekday] = useState<boolean>(bootstrap?.displaySettings?.showWeekday ?? false);
    const [responseStateTrackingEnabled, setResponseStateTrackingEnabled] = useState<boolean>(bootstrap?.displaySettings?.responseStateTrackingEnabled ?? true);
    const [defaultReplyInternal, setDefaultReplyInternal] = useState(bootstrap?.displaySettings?.defaultReplyInternal ?? false);
    const [createdRelativeTime, setCreatedRelativeTime] = useState<string>('');
    const [updatedRelativeTime, setUpdatedRelativeTime] = useState<string>('');
    const [addChildTicketNumber, setAddChildTicketNumber] = useState<string>('');
    const [selectedChildTicket, setSelectedChildTicket] = useState<{
        ticket_id: string;
        client_id: string | null;
        ticket_number: string;
    } | null>(null);
    const [searchResults, setSearchResults] = useState<EligibleChildTicket[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearchResults, setShowSearchResults] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchContainerRef = useRef<HTMLDivElement>(null);
    const [isUpdatingBundleSettings, setIsUpdatingBundleSettings] = useState(false);
    const [isAddChildMultiClientConfirmOpen, setIsAddChildMultiClientConfirmOpen] = useState(false);
    const [pendingChildToAdd, setPendingChildToAdd] = useState<{ ticket_id: string; ticket_number?: string | null; client_id?: string | null } | null>(null);
    const [isClosedMasterChoiceOpen, setIsClosedMasterChoiceOpen] = useState(false);
    const [closedMasterContext, setClosedMasterContext] = useState<BundleMasterClosedContextActionResult | null>(null);
    const [closedMasterChoice, setClosedMasterChoice] = useState<ClosedMasterChoice | null>(null);
    const [pendingClosedMasterChildId, setPendingClosedMasterChildId] = useState<string | null>(null);
    const [isModeSwitchPending, setIsModeSwitchPending] = useState(false);
    const [isLoadingClosedMasterContext, setIsLoadingClosedMasterContext] = useState(false);
    const [isWatchListSaving, setIsWatchListSaving] = useState(false);
    const [allContactsForWatchList, setAllContactsForWatchList] = useState<IContact[]>([]);
    const [allContactsForWatchListLoading, setAllContactsForWatchListLoading] = useState(false);
    // Single source of truth for this ticket's links: seeded from the server
    // bootstrap, then kept current by the section's onLinksChanged so the origin
    // badge and comment chips update immediately on add/edit/remove — no reload.
    const [externalLinks, setExternalLinks] = useState<ITicketExternalLinkView[] | null>(
        capabilities.externalLinks ? bootstrap?.externalLinks ?? null : null,
    );
    const originExternalLink = useMemo(
        () => (externalLinks ?? []).find(
            (link) => link.entity_type === 'ticket' && link.relationship === 'origin',
        ),
        [externalLinks],
    );
    const externalLinksByCommentId = useMemo(() => {
        const grouped: Record<string, ITicketExternalLinkView[]> = {};
        for (const link of externalLinks ?? []) {
            if (link.entity_type !== 'comment' || !link.entity_id) continue;
            (grouped[link.entity_id] ??= []).push(link);
        }
        return grouped;
    }, [externalLinks]);
    const ticketOrigin = useMemo(
        () =>
            getTicketOrigin({
                ...(ticket as any),
                origin_link_system: originExternalLink?.system ?? null,
            }),
        [ticket, originExternalLink?.system],
    );
    // The definition a recurring ticket came from; null (no link) when the viewer may not read definitions.
    // Not a capability: the data source's getRecurringSourceForTicket answers null when it has none.
    const [recurringSource, setRecurringSource] = useState<RecurringTicketSource | null>(null);
    useEffect(() => {
        if (ticketOrigin !== 'recurring' || !ticket.ticket_id) {
            setRecurringSource(null);
            return;
        }
        let cancelled = false;
        void getRecurringSourceForTicket(ticket.ticket_id)
            .then((source) => { if (!cancelled) setRecurringSource(source ?? null); })
            .catch((error) => console.error('Failed to load the recurring ticket source:', error));
        return () => { cancelled = true; };
    }, [ticketOrigin, ticket.ticket_id, getRecurringSourceForTicket]);
    const ticketOriginLabels = useMemo(() => ({
        internal: t('origin.internal', 'Created Internally'),
        clientPortal: t('origin.clientPortal', 'Created via Client Portal'),
        inboundEmail: t('origin.inboundEmail', 'Created via Inbound Email'),
        api: t('origin.api', 'Created via API'),
        recurring: t('origin.recurring', 'Created by Recurring Schedule'),
        other: t('origin.other', 'Created via Other'),
    }), [t]);
    const [ticketInfoDirtyFields, setTicketInfoDirtyFields] = useState<string[]>([]);

    // Grid | Entry layout toggle (per-user preference). Grid is the default;
    // a stored 'entry' preference keeps the existing layout untouched.
    const [layoutMode, setLayoutMode] = useState<TicketDetailLayout>(
        bootstrap?.layoutPreference?.layout ?? 'grid',
    );
    const [timelinePrefOrder, setTimelinePrefOrder] = useState<'asc' | 'desc'>(
        bootstrap?.layoutPreference?.timelineOrder ?? 'asc',
    );
    const [isAllFieldsDrawerOpen, setIsAllFieldsDrawerOpen] = useState(false);
    // Set once the user picks a layout on this screen. The stored preference only
    // seeds the initial layout: a load that resolves after an explicit choice must
    // not switch layouts, which would unmount an open composer and its draft.
    const layoutChosenRef = useRef(false);

    useEffect(() => {
        if (bootstrapSkips.current.layout) {
            bootstrapSkips.current.layout = false;
            return;
        }
        let cancelled = false;
        getTicketLayoutPreference()
            .then((prefs) => {
                if (cancelled) return;
                if (isReturnedActionError(prefs)) {
                    console.warn('Unable to load ticket layout preference:', getErrorMessage(prefs));
                    return;
                }
                if (!layoutChosenRef.current) {
                    setLayoutMode(prefs.layout);
                }
                setTimelinePrefOrder(prefs.timelineOrder);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const handleLayoutModeChange = useCallback((next: TicketDetailLayout) => {
        layoutChosenRef.current = true;
        setLayoutMode(next);
        void setTicketLayoutPreference({ layout: next })
            .then((result) => {
                if (isReturnedActionError(result)) {
                    console.warn('Unable to save ticket layout preference:', getErrorMessage(result));
                }
            })
            .catch(() => undefined);
    }, []);

    const useGridLayout = layoutMode === 'grid' && !isInDrawer;

    // Show title in sticky header only when the card title scrolls out of view.
    // Entry and grid render different title nodes, so re-attach on layout flips.
    useEffect(() => {
        const el = cardTitleRef.current;
        if (!el) {
            setCardTitleVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => setCardTitleVisible(entry.isIntersecting),
            { threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [useGridLayout]);
    const [ticketPropertiesDirtyFields, setTicketPropertiesDirtyFields] = useState<string[]>([]);
    const [liveHighlightedFields, setLiveHighlightedFields] = useState<string[]>([]);
    const [liveFieldConflicts, setLiveFieldConflicts] = useState<Partial<Record<string, TicketLiveConflictState>>>({});
    const frozenFieldList = useMemo(
        () => resolveTicketFrozenFields(dataSource.screen, Object.keys(liveFieldConflicts)),
        [dataSource.screen, liveFieldConflicts],
    );
    const [reactionRefreshVersion, setReactionRefreshVersion] = useState(0);
    const [livePendingFieldVersion, setLivePendingFieldVersion] = useState(0);
    const ticketInfoDirtyFieldsRef = useRef<string[]>([]);
    const ticketPropertiesDirtyFieldsRef = useRef<string[]>([]);
    const pendingLiveNetworkFieldsRef = useRef<Set<string>>(new Set());
    const pendingRemoteUpdateRef = useRef<TicketLiveRemoteUpdate | null>(null);
    const remoteUpdateTimerRef = useRef<NodeJS.Timeout | null>(null);
    const liveHighlightTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

    const runWithPendingLiveFields = useCallback(async <T,>(fields: string[], fn: () => Promise<T>): Promise<T> => {
        const normalizedFields = Array.from(new Set(fields.map((field) => normalizeTicketLiveField(field))));

        for (const field of normalizedFields) {
            pendingLiveNetworkFieldsRef.current.add(field);
        }
        setLivePendingFieldVersion((current) => current + 1);

        try {
            return await fn();
        } finally {
            for (const field of normalizedFields) {
                pendingLiveNetworkFieldsRef.current.delete(field);
            }
            setLivePendingFieldVersion((current) => current + 1);
        }
    }, []);

    const liveDirtyFieldSet = useMemo(() => {
        const fields = new Set<string>();

        for (const field of ticketInfoDirtyFields) {
            fields.add(normalizeTicketLiveField(field));
        }
        for (const field of ticketPropertiesDirtyFields) {
            fields.add(normalizeTicketLiveField(field));
        }
        for (const field of pendingLiveNetworkFieldsRef.current) {
            fields.add(normalizeTicketLiveField(field));
        }

        return fields;
    }, [livePendingFieldVersion, ticketInfoDirtyFields, ticketPropertiesDirtyFields]);

    const liveEditingUsers = useMemo(() => {
        const editingUsersByField: Partial<Record<string, string[]>> = {};
        const seenByField = new Map<string, Set<string>>();

        for (const presenceUser of ticketLive.presence) {
            if (!presenceUser.editingField) {
                continue;
            }

            const field = normalizeTicketLiveField(presenceUser.editingField);
            const seenUsers = seenByField.get(field) ?? new Set<string>();
            if (seenUsers.has(presenceUser.userId)) {
                continue;
            }

            seenUsers.add(presenceUser.userId);
            seenByField.set(field, seenUsers);
            editingUsersByField[field] = [...(editingUsersByField[field] ?? []), presenceUser.displayName];
        }

        return editingUsersByField;
    }, [ticketLive.presence]);

    useEffect(() => {
        ticketInfoDirtyFieldsRef.current = ticketInfoDirtyFields;
    }, [ticketInfoDirtyFields]);

    useEffect(() => {
        ticketPropertiesDirtyFieldsRef.current = ticketPropertiesDirtyFields;
    }, [ticketPropertiesDirtyFields]);

    const clearRemoteUpdateTimer = useCallback(() => {
        if (remoteUpdateTimerRef.current) {
            clearTimeout(remoteUpdateTimerRef.current);
            remoteUpdateTimerRef.current = null;
        }
    }, []);

    const highlightLiveFields = useCallback((fields: string[]) => {
        const normalizedFields = Array.from(new Set(fields.map((field) => normalizeTicketLiveField(field))));

        if (normalizedFields.length === 0) {
            return;
        }

        setLiveHighlightedFields((current) => Array.from(new Set([...current, ...normalizedFields])));

        for (const field of normalizedFields) {
            if (liveHighlightTimersRef.current[field]) {
                clearTimeout(liveHighlightTimersRef.current[field]);
            }

            liveHighlightTimersRef.current[field] = setTimeout(() => {
                setLiveHighlightedFields((current) => current.filter((currentField) => currentField !== field));
                delete liveHighlightTimersRef.current[field];
            }, LIVE_UPDATE_HIGHLIGHT_MS);
        }
    }, []);

    const getLiveFieldLabel = useCallback((field: string) => {
        switch (normalizeTicketLiveField(field)) {
            case 'title':
                return t('fields.title', 'title').toLowerCase();
            case 'status_id':
                return t('fields.status', 'status').toLowerCase();
            case 'priority_id':
                return t('fields.priority', 'priority').toLowerCase();
            case 'assigned_to':
                return t('fields.assignedTo', 'assigned to').toLowerCase();
            case 'board_id':
                return t('info.board', 'board').toLowerCase();
            case 'category_id':
                return t('fields.category', 'category').toLowerCase();
            case 'itil_impact':
                return t('itil.impact', 'impact').toLowerCase();
            case 'itil_urgency':
                return t('itil.urgency', 'urgency').toLowerCase();
            case 'client_id':
                return t('fields.client', 'client').toLowerCase();
            case 'contact_name_id':
                return t('properties.contact', 'contact').toLowerCase();
            case 'location_id':
                return t('properties.location', 'location').toLowerCase();
            case 'response_state':
                return t('fields.responseState', 'response state').toLowerCase();
            case 'due_date':
                return t('fields.dueDate', 'due date').toLowerCase();
            default:
                return normalizeTicketLiveField(field).replace(/_/g, ' ');
        }
    }, [t]);

    const isRemoteUpdateAccessError = useCallback((error: unknown) => {
        if (isActionPermissionError(error)) {
            return true;
        }

        if (error instanceof Error) {
            return /403|forbidden|permission denied/i.test(error.message);
        }

        if (typeof error === 'string') {
            return /403|forbidden|permission denied/i.test(error);
        }

        return false;
    }, []);

    const clearLiveFieldConflict = useCallback((field: string) => {
        setLiveFieldConflicts((current) => {
            if (!current[field]) {
                return current;
            }

            const next = { ...current };
            delete next[field];
            return next;
        });
    }, []);

    const handleKeepLiveConflict = useCallback((field: string) => {
        clearLiveFieldConflict(field);
    }, [clearLiveFieldConflict]);

    const handleTakeLiveConflict = useCallback((field: string) => {
        clearLiveFieldConflict(field);
        highlightLiveFields([field]);
    }, [clearLiveFieldConflict, highlightLiveFields]);

    const refreshTicketSnapshot = useCallback(async (
        updatedFields: string[] = [],
        remoteUpdatedBy?: { userId: string | null; displayName: string }
    ) => {
        if (!ticket.ticket_id) {
            return { refreshed: false as const };
        }

        try {
            const latestTicket = await getTicketById(ticket.ticket_id);
            if (isReturnedActionError(latestTicket)) {
                throw latestTicket;
            }
            const normalizedUpdatedFields = new Set(updatedFields.map((field) => normalizeTicketLiveField(field)));

            setTicket(latestTicket);
            // Resolve who made the latest write. The live-update payload carries the
            // actor's display name; without it keep the name only if it still matches.
            setUpdatedByUser((previous) => {
                const latestUpdatedBy = latestTicket.updated_by ?? null;
                if (!latestUpdatedBy) return null;
                if (previous?.user_id === latestUpdatedBy) return previous;
                if (remoteUpdatedBy?.userId === latestUpdatedBy) {
                    return { user_id: latestUpdatedBy, first_name: remoteUpdatedBy.displayName, last_name: '' } as IUser;
                }
                return null;
            });
            setItilImpact(latestTicket.itil_impact || undefined);
            setItilUrgency(latestTicket.itil_urgency || undefined);
            setSavedBoardId(latestTicket.board_id ?? null);

            const shouldRefreshClientContext =
                normalizedUpdatedFields.has('client_id') || latestTicket.client_id !== ticket.client_id;
            const shouldRefreshContactContext =
                normalizedUpdatedFields.has('contact_name_id') || latestTicket.contact_name_id !== ticket.contact_name_id;
            const shouldRefreshLocationContext =
                normalizedUpdatedFields.has('location_id') || latestTicket.location_id !== ticket.location_id;

            if (shouldRefreshClientContext) {
                if (!latestTicket.client_id) {
                    setClient(null);
                    setContacts([]);
                    setLocations([]);
                    setContactInfo(null);
                } else {
                    const [latestClient, latestContacts, latestLocations] = await Promise.all([
                        getClientById(latestTicket.client_id),
                        getContactsByClient(latestTicket.client_id),
                        getClientLocations(latestTicket.client_id),
                    ]);

                    setClient(latestClient);
                    setContacts(latestContacts || []);
                    setLocations(latestLocations || []);
                    setContactInfo(
                        latestTicket.contact_name_id
                            ? await getContactByContactNameId(latestTicket.contact_name_id)
                            : null
                    );
                }
            } else {
                if (shouldRefreshContactContext) {
                    setContactInfo(
                        latestTicket.contact_name_id
                            ? await getContactByContactNameId(latestTicket.contact_name_id)
                            : null
                    );
                }

                if (shouldRefreshLocationContext && latestTicket.client_id) {
                    setLocations(await getClientLocations(latestTicket.client_id));
                }
            }

            if (normalizedUpdatedFields.has('comments')) {
                const comments = await findCommentsByTicketId(ticket.ticket_id);
                if (isReturnedActionError(comments)) {
                    handleTicketActionError(comments, t('messages.loadCommentsFailed', 'Failed to load comments'));
                } else {
                    setConversations(comments);
                }
            }

            if (normalizedUpdatedFields.has('comment_reactions')) {
                setReactionRefreshVersion((value) => value + 1);
            }

            return { refreshed: true as const, latestTicket };
        } catch (error) {
            if (isRemoteUpdateAccessError(error)) {
                router.push(ticketsListHref);
                return { refreshed: false as const, redirected: true as const };
            }

            console.warn('Failed to refresh live ticket snapshot', error);
            return { refreshed: false as const, error };
        }
    }, [
        getClientLocations,
        getContactByContactNameId,
        getClientById,
        getContactsByClient,
        isRemoteUpdateAccessError,
        router,
        ticketsListHref,
        ticket.client_id,
        ticket.contact_name_id,
        ticket.location_id,
        ticket.ticket_id,
    ]);

    const flushPendingRemoteUpdate = useCallback(async () => {
        const pendingUpdate = pendingRemoteUpdateRef.current;
        pendingRemoteUpdateRef.current = null;
        remoteUpdateTimerRef.current = null;

        if (!pendingUpdate || pendingUpdate.updatedFields.length === 0) {
            return;
        }

        const dirtyFields = new Set<string>();

        for (const field of ticketInfoDirtyFieldsRef.current) {
            dirtyFields.add(normalizeTicketLiveField(field));
        }
        for (const field of ticketPropertiesDirtyFieldsRef.current) {
            dirtyFields.add(normalizeTicketLiveField(field));
        }
        for (const field of pendingLiveNetworkFieldsRef.current) {
            dirtyFields.add(normalizeTicketLiveField(field));
        }

        const updatedFields = Array.from(new Set(pendingUpdate.updatedFields.map((field) => normalizeTicketLiveField(field))));
        const overlappingFields = updatedFields.filter((field) => dirtyFields.has(field));
        const nonOverlappingFields = updatedFields.filter((field) => !dirtyFields.has(field));

        const refreshResult = await refreshTicketSnapshot(pendingUpdate.updatedFields, pendingUpdate.updatedBy);
        if (!refreshResult.refreshed) {
            return;
        }

        // A remote field-only change moves none of timelineRefreshKey's counters
        // (comments/activity/time), so the grid timeline would never refetch its
        // system rows. Bump the activity key so the "changed status/priority/…"
        // row appears live, the same way remote comments already do.
        if (pendingUpdate.updatedFields.some((field) => field !== 'comments')) {
            setActivityLogRefreshKey((value) => value + 1);
        }

        if (nonOverlappingFields.length > 0) {
            highlightLiveFields(nonOverlappingFields);
        }

        if (overlappingFields.length > 0) {
            setLiveFieldConflicts((current) => {
                const next = { ...current };

                for (const field of overlappingFields) {
                    next[field] = {
                        updatedFields: pendingUpdate.updatedFields.filter(
                            (updatedField) => normalizeTicketLiveField(updatedField) === field
                        ),
                        updatedBy: pendingUpdate.updatedBy,
                        updatedAt: pendingUpdate.updatedAt,
                    };
                }

                return next;
            });
            return;
        }

        if (dirtyFields.size > 0 && nonOverlappingFields.length > 0) {
            toast.success(
                t('liveUpdates.remoteFieldUpdated', '{{name}} updated {{field}}')
                    .replace('{{name}}', pendingUpdate.updatedBy.displayName)
                    .replace('{{field}}', getLiveFieldLabel(nonOverlappingFields[0]))
            );
        }
    }, [getLiveFieldLabel, highlightLiveFields, refreshTicketSnapshot, t]);

    const queueRemoteUpdate = useCallback((update: TicketLiveRemoteUpdate) => {
        const currentPendingUpdate = pendingRemoteUpdateRef.current;

        pendingRemoteUpdateRef.current = currentPendingUpdate
            ? {
                updatedFields: Array.from(new Set([...currentPendingUpdate.updatedFields, ...update.updatedFields])),
                updatedBy: update.updatedBy,
                updatedAt: update.updatedAt,
            }
            : update;

        clearRemoteUpdateTimer();
        remoteUpdateTimerRef.current = setTimeout(() => {
            void flushPendingRemoteUpdate();
        }, LIVE_UPDATE_REFETCH_DEBOUNCE_MS);
    }, [clearRemoteUpdateTimer, flushPendingRemoteUpdate]);

    useEffect(() => {
        setBundle(capabilities.bundles ? initialBundle : null);
    }, [initialBundle, capabilities.bundles]);

    useEffect(() => {
        setBoard(initialBoard);
        setSavedBoardId(initialBoard?.board_id ?? initialTicket.board_id ?? null);
    }, [initialBoard, initialTicket.board_id]);

    useEffect(() => {
        if (!ticketLive.enabled || ticketLive.reconnectVersion === 0) {
            return;
        }

        void refreshTicketSnapshot();
    }, [refreshTicketSnapshot, ticketLive.enabled, ticketLive.reconnectVersion]);

    useEffect(() => {
        const remoteUpdate = ticketLive.lastRemoteUpdate;
        if (!ticketLive.enabled || !remoteUpdate || remoteUpdate.updatedBy.userId === userId) {
            return;
        }

        queueRemoteUpdate(remoteUpdate);
    }, [queueRemoteUpdate, ticketLive.enabled, ticketLive.lastRemoteUpdate, userId]);

    useEffect(() => {
        return () => {
            clearRemoteUpdateTimer();

            for (const timer of Object.values(liveHighlightTimersRef.current)) {
                clearTimeout(timer);
            }

            liveHighlightTimersRef.current = {};
        };
    }, [clearRemoteUpdateTimer]);

    useEffect(() => {
        setLiveFieldConflicts((current) => {
            const nextEntries = Object.entries(current).filter(([field]) => liveDirtyFieldSet.has(field));

            if (nextEntries.length === Object.keys(current).length) {
                return current;
            }

            return Object.fromEntries(nextEntries);
        });
    }, [liveDirtyFieldSet]);

    useEffect(() => {
        let cancelled = false;

        if (bootstrapSkips.current.board) {
            bootstrapSkips.current.board = false;
            return;
        }
        const loadBoard = async () => {
            if (!savedBoardId) {
                if (!cancelled) {
                    setBoard(null);
                }
                return;
            }

            try {
                const fetchedBoard = await findBoardById(savedBoardId);
                if (isReturnedActionError(fetchedBoard)) {
                    if (!cancelled) {
                        setBoard(null);
                    }
                    handleError(fetchedBoard, getErrorMessage(fetchedBoard));
                    return;
                }
                if (!cancelled) {
                    setBoard(fetchedBoard ?? null);
                }
            } catch (error) {
                console.error('Failed to refresh board metadata:', error);
            }
        };

        loadBoard();

        return () => {
            cancelled = true;
        };
    }, [savedBoardId]);

    // Use pre-fetched options directly
    const [userMap, setUserMap] = useState<Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>>(initialUserMap);

    // Identity stamped into the "Updated … by" header after a local save. The drawer passes a
    // full currentUser; full-page callers do not, so derive one from the session (resolving the
    // name from userMap like TicketDetailsContainer's liveCurrentUser). Null only when signed out.
    const localActor = useMemo<IUser | null>(() => {
        if (currentUser) return currentUser;
        const sessionUserId = session?.user?.id;
        if (!sessionUserId) return null;
        const mapped = userMap?.[sessionUserId];
        const sessionName = (session?.user?.name ?? '').trim();
        const [sessionFirst, ...sessionRest] = sessionName.split(/\s+/).filter(Boolean);
        return {
            user_id: sessionUserId,
            first_name: mapped ? mapped.first_name : (sessionFirst ?? ''),
            last_name: mapped ? mapped.last_name : sessionRest.join(' '),
            email: mapped?.email ?? session?.user?.email ?? '',
            user_type: mapped?.user_type ?? 'internal',
        } as unknown as IUser;
    }, [currentUser, session?.user?.id, session?.user?.name, session?.user?.email, userMap]);
    const [contactMap] = useState<Record<string, { contact_id: string; full_name: string; email?: string; avatarUrl: string | null }>>(initialContactMap);

    const [availableAgents, setAvailableAgents] = useState<IUserWithRoles[]>(initialAvailableAgents);
    const [additionalAgents, setAdditionalAgents] = useState<ITicketResource[]>(initialAdditionalAgents);

    const additionalAgentsForInfo = useMemo(() => {
        return additionalAgents.map(a => {
            const userId = a.additional_user_id || a.assigned_to;
            const agent = availableAgents.find(u => u.user_id === userId);
            return {
                user_id: userId,
                name: agent ? `${agent.first_name} ${agent.last_name || ''}`.trim() : '',
            };
        });
    }, [additionalAgents, availableAgents]);

    const [newCommentContent, setNewCommentContent] = useState<PartialBlock[]>([{
        type: "paragraph",
        props: {
            textAlignment: "left",
            backgroundColor: "default",
            textColor: "default"
        },
        content: [{
            type: "text",
            text: "",
            styles: {}
        }]
    }]);
    const [activeTab, setActiveTab] = useState('all-comments');
    const [isEditing, setIsEditing] = useState(false);
    const [currentComment, setCurrentComment] = useState<IComment | null>(null);

    const [timeDescription, setTimeDescription] = useState('');
    const [timeEntriesRefreshKey, setTimeEntriesRefreshKey] = useState(0);
    const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
    const [tags, setTags] = useState<ITag[]>(bootstrap?.tags ?? []);
    const { tags: allTags } = useTags();
    const [currentTimeSheet, setCurrentTimeSheet] = useState<ITimeSheet | null>(null);
    const [currentTimePeriod, setCurrentTimePeriod] = useState<ITimePeriodView | null>(null);

    const [team, setTeam] = useState<ITeam | null>(null);
    const [teams, setTeams] = useState<ITeam[]>(bootstrap?.teams ?? []);
    const [isChangeContactDialogOpen, setIsChangeContactDialogOpen] = useState(false);
    const [isChangeClientDialogOpen, setIsChangeClientDialogOpen] = useState(false);
    const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
    const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [commentToDelete, setCommentToDelete] = useState<PendingCommentDelete | null>(null);
    const [isDeletingComment, setIsDeletingComment] = useState(false);
    const [isTimeEntryPeriodDialogOpen, setIsTimeEntryPeriodDialogOpen] = useState(false);
    const [pendingDeleteTimeEntry, setPendingDeleteTimeEntry] = useState<{ entry_id: string; user_name: string | null } | null>(null);
    const [isDeletingTimeEntry, setIsDeletingTimeEntry] = useState(false);
    // Synchronous ref mirrors the state so rapid repeat clicks land before React
    // re-renders and can be dropped instead of starting a second launch chain.
    const isLaunchingTimeEntryRef = useRef(false);
    const [isLaunchingTimeEntry, setIsLaunchingTimeEntry] = useState(false);

    // Debounced search for child tickets
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const childTicketSearchSeqRef = useRef(0);

    const cancelChildTicketSearch = useCallback(() => {
        childTicketSearchSeqRef.current += 1;
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
        }
        setIsSearching(false);
    }, []);

    const resetChildTicketPickerState = useCallback(() => {
        cancelChildTicketSearch();
        setSearchResults([]);
        setShowSearchResults(false);
        setSelectedChildTicket(null);
    }, [cancelChildTicketSearch]);

    // ITIL-specific state for editing
    const [itilImpact, setItilImpact] = useState<number | undefined>(ticket.itil_impact || undefined);
    const [itilUrgency, setItilUrgency] = useState<number | undefined>(ticket.itil_urgency || undefined);
    // NOTE: ITIL categories are now managed through the unified category system

    const { openDrawer, closeDrawer, replaceDrawer } = useDrawer();
    const { launchTimeEntry, deleteTimeEntry, launchScheduleEntry } = useSchedulingCallbacks();

    const resetTicketDeleteState = useCallback(() => {
        if (isTicketDeleteProcessing) return;
        setIsDeleteTicketDialogOpen(false);
        setTicketDeleteValidation(null);
        setIsTicketDeleteValidating(false);
    }, [isTicketDeleteProcessing]);

    const runTicketDeleteValidation = useCallback(async () => {
        if (!ticket.ticket_id) return;
        setIsTicketDeleteValidating(true);
        try {
            const result = await preCheckDeletion('ticket', ticket.ticket_id);
            setTicketDeleteValidation(result);
        } catch (error: any) {
            console.error('Failed to validate ticket deletion:', error);
            setTicketDeleteValidation({
                canDelete: false,
                code: 'VALIDATION_FAILED',
                message: t('delete.validationError', {
                    defaultValue: 'Failed to validate deletion. Please try again.',
                }),
                dependencies: [],
                alternatives: [],
            });
        } finally {
            setIsTicketDeleteValidating(false);
        }
    }, [ticket.ticket_id, t]);

    const handleDeleteTicket = useCallback(() => {
        setIsDeleteTicketDialogOpen(true);
        void runTicketDeleteValidation();
    }, [runTicketDeleteValidation]);

    const confirmTicketDelete = useCallback(async () => {
        if (!ticket.ticket_id) return;
        setIsTicketDeleteProcessing(true);
        try {
            const result = await deleteTicket(ticket.ticket_id);

            if (!result.success) {
                // Surface blocking dependencies / permission issues in the dialog.
                setTicketDeleteValidation(result);
                return;
            }

            setIsDeleteTicketDialogOpen(false);
            setTicketDeleteValidation(null);
            toast.success(t('delete.success', {
                defaultValue: 'Ticket #{{number}} deleted successfully.',
                number: ticket.ticket_number,
            }));

            // Notify before closing: closing the drawer unmounts this component.
            onSaved?.();

            if (isInDrawer) {
                closeDrawer();
                onClose?.();
            } else {
                // Preserve the list filters the user came in with (same mechanism
                // as the Back button / BackNav) so the tickets list reopens filtered.
                const returnFilters = searchParams?.get('returnFilters') ?? null;
                const filtersQuery = returnFilters ? decodeURIComponent(returnFilters) : '';
                router.push(filtersQuery ? `${ticketsListHref}?${filtersQuery}` : ticketsListHref);
            }
        } catch (error: any) {
            console.error('Failed to delete ticket:', error);
            toast.error(error?.message || t('delete.error', {
                defaultValue: 'Failed to delete ticket. Please try again.',
            }));
        } finally {
            setIsTicketDeleteProcessing(false);
        }
    }, [ticket.ticket_id, ticket.ticket_number, isInDrawer, closeDrawer, onClose, onSaved, router, searchParams, t, ticketsListHref]);

    useEffect(() => {
        if (bootstrapSkips.current.teams) {
            bootstrapSkips.current.teams = false;
            return;
        }
        const loadTeams = async () => {
            try {
                const fetchedTeams = await getTeams();
                if (isTeamActionError(fetchedTeams)) {
                    console.warn('Cannot load teams for ticket details:', fetchedTeams);
                    setTeams([]);
                    return;
                }
                setTeams(fetchedTeams);
            } catch (error) {
                console.error('Failed to load teams:', error);
            }
        };
        loadTeams();
    }, []);

    useEffect(() => {
        if (!ticket.assigned_team_id) {
            setTeam(null);
            return;
        }

        const cached = teams.find(t => t.team_id === ticket.assigned_team_id);
        if (cached) {
            setTeam(cached);
            return;
        }

        const loadTeam = async () => {
            try {
                const fetchedTeam = await getTeamById(ticket.assigned_team_id!);
                if (isTeamActionError(fetchedTeam)) {
                    console.warn('Cannot load assigned team:', fetchedTeam);
                    setTeam(null);
                    return;
                }
                setTeam(fetchedTeam);
            } catch (error) {
                console.error('Failed to load assigned team:', error);
                setTeam(null);
            }
        };
        loadTeam();
    }, [ticket.assigned_team_id, teams]);

    // Load ticketing display settings
    useEffect(() => {
        if (bootstrapSkips.current.display) {
            bootstrapSkips.current.display = false;
            return;
        }
        const loadDisplaySettings = async () => {
            try {
                const settings = await getTicketingDisplaySettings();
                setShowWeekday(settings?.showWeekday ?? false);
                setResponseStateTrackingEnabled(settings?.responseStateTrackingEnabled ?? true);
                setDefaultReplyInternal(settings?.defaultReplyInternal ?? false);
            } catch (error) {
                console.error('Failed to load ticketing display settings:', error);
            }
        };
        loadDisplaySettings();
    }, []);

    // Calculate relative time strings only on client side to avoid hydration mismatch
    useEffect(() => {
        const tz = getUserTimeZone();
        
        if (ticket.entered_at) {
            const formattedDate = formatTicketDateTime(ticket.entered_at, locale, tz, dateFormat, showWeekday);
            const distance = formatTicketRelativeToNow(ticket.entered_at, locale);
            setCreatedRelativeTime(`${formattedDate} (${distance})`);
        }

        if (ticket.updated_at) {
            const formattedDate = formatTicketDateTime(ticket.updated_at, locale, tz, dateFormat, showWeekday);
            const distance = formatTicketRelativeToNow(ticket.updated_at, locale);
            setUpdatedRelativeTime(`${formattedDate} (${distance})`);
        }
    }, [ticket.entered_at, ticket.updated_at, dateFormat, showWeekday, locale]);

    // Fetch tags when component mounts
    useEffect(() => {
        if (bootstrapSkips.current.tags) {
            bootstrapSkips.current.tags = false;
            return;
        }
        const fetchTags = async () => {
            if (!capabilities.tags || !ticket.ticket_id) return;
            
            try {
                const ticketTags = await findTagsByEntityId(ticket.ticket_id, 'ticket');
                if (isTagActionError(ticketTags)) {
                    console.error('Error fetching tags:', ticketTags);
                    setTags([]);
                    return;
                }
                setTags(ticketTags);
            } catch (error) {
                console.error('Error fetching tags:', error);
            }
        };
        fetchTags();
    }, [ticket.ticket_id, capabilities.tags]);

    const handleClientClick = async () => {
        if (!client?.client_id) return;

        openDrawer(<div className="p-4 text-sm text-gray-600">{t('info.loading', 'Loading…')}</div>, undefined, undefined, '900px');
        try {
            const fullClient = await getClientById(client.client_id);
            if (!fullClient) {
                replaceDrawer(<div className="p-4 text-sm text-gray-600">{t('dashboard.drawer.clientNotFound', 'Client not found.')}</div>);
                return;
            }

            replaceDrawer(
                renderClientDetails
                    ? renderClientDetails({
                        id: `${id}-client-details`,
                        client: fullClient
                    })
                    : (
                        <div className="p-4 space-y-3">
                            <div className="text-lg font-semibold">{fullClient.client_name}</div>
                            <Button
                                id="ticket-details-open-client"
                                type="button"
                                variant="outline"
                                onClick={() => window.open(`/msp/clients/${fullClient.client_id}`, '_blank', 'noopener,noreferrer')}
                            >
                                {t('info.openClient', 'Open Client')} <ExternalLink className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    ),
                undefined,
                '900px'
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : t('dashboard.drawer.clientLoadFailed', 'Failed to load client.');
            replaceDrawer(<div className="p-4 text-sm text-red-600">{message}</div>);
        }
    };

    const handleContactClick = async () => {
        const contactNameId = ticket.contact_name_id || contactInfo?.contact_name_id;
        if (!contactNameId) {
            openDrawer(<div className="text-sm text-gray-600">{t('info.noContactSelected', 'No contact selected.')}</div>);
            return;
        }

        openDrawer(<div className="p-4 text-sm text-gray-600">{t('info.loading', 'Loading…')}</div>, undefined, undefined, '900px');
        try {
            const contact = await getContactByContactNameId(contactNameId);
            if (!contact) {
                replaceDrawer(<div className="p-4 text-sm text-gray-600">{t('info.contactNotFound', 'Contact not found.')}</div>);
                return;
            }

            const minimalClients =
                clients.length > 0 ? clients : client ? [client] : [];

            replaceDrawer(
                renderContactDetails
                    ? renderContactDetails({
                        id: `${id}-contact-details`,
                        contact,
                        clients: minimalClients,
                        userId
                    })
                    : (
                        <div className="p-4 space-y-3">
                            <div className="text-lg font-semibold">
                                {contact.full_name || t('properties.contact', 'Contact')}
                            </div>
                            <Button
                                id="ticket-details-open-contact"
                                type="button"
                                variant="outline"
                                onClick={() => window.open(`/msp/contacts/${contact.contact_name_id}`, '_blank', 'noopener,noreferrer')}
                            >
                                {t('info.openContact', 'Open Contact')} <ExternalLink className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    ),
                undefined,
                '900px'
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : t('info.contactLoadFailed', 'Failed to load contact.');
            replaceDrawer(<div className="p-4 text-sm text-red-600">{message}</div>);
        }
    };

  const handleAgentClick = (userId: string) => {
    if (disableAgentSchedule || !capabilities.scheduling) {
      return;
    }

    if (!ticket.ticket_id) {
      return;
    }

    // Seven day columns need the room; the drawer caps itself at 60vw.
    openDrawer(
      <AgentScheduleDrawer
        agentId={userId}
        workItemContext={buildScheduleContext(ticket.ticket_id)}
      />,
      undefined,
      undefined,
      '1200px'
    );
  };

  /** The ticket as a schedulable work item, shared by every scheduling surface on this page. */
  const buildScheduleContext = (ticketId: string): WorkItemScheduleContext => ({
    workItemId: ticketId,
    workItemType: 'ticket',
    title: ticket.title || t('bento.tiles.scheduledWork', 'Scheduled work'),
    clientName: client?.client_name ?? null,
    defaultAssigneeId: ticket.assigned_to ?? null,
    onScheduled: () => setScheduleRefreshKey((value) => value + 1),
  });

    const handleAddAgent = async (userId: string) => {
        try {
            const result = await addTicketResource(ticket.ticket_id!, userId, 'support');
            if (isReturnedActionError(result)) {
                throw result;
            }

            if (result) {
                setAdditionalAgents(prev => [...prev, result]);
                toast.success(t('messages.agentAdded'));
                onSaved?.();
            } else {
                setTicket(prevTicket => ({
                    ...prevTicket,
                    assigned_to: userId
                }));
                toast.success(t('messages.agentAssigned'));
                onSaved?.();
            }
        } catch (error) {
            handleTicketActionError(error, t('messages.addAgentFailed'));
        }
    };  
    
    const handleRemoveAgent = async (assignmentId: string) => {
        try {
            const result = await removeTicketResource(assignmentId);
            if (isReturnedActionError(result)) {
                throw result;
            }
            setAdditionalAgents(prev => prev.filter(agent => agent.assignment_id !== assignmentId));
            toast.success(t('messages.agentRemoved'));
            onSaved?.();
        } catch (error) {
            handleTicketActionError(error, t('messages.removeAgentFailed'));
        }
    };

    const handleSelectChange = async (field: keyof ITicket, newValue: string | null) => {
        const normalizedValue =
            field === 'assigned_to'
                ? (newValue && newValue !== 'unassigned' ? newValue : null)
                : newValue;

        // Status changes run the full gate: close rules first, then the bundle
        // propagation confirmation. A cancelled confirmation leaves the select
        // on its current value with no write.
        let propagationDecision: { proceed: boolean; propagateToChildren?: boolean } = { proceed: true };
        if (field === 'status_id' && normalizedValue) {
            propagationDecision = await confirmStatusChange(normalizedValue);
            if (!propagationDecision.proceed) {
                return;
            }
        }

        // Store the previous value before updating
        const previousValue = ticket[field];

        // Optimistically update the UI
        setTicket(prevTicket => ({ ...prevTicket, [field]: normalizedValue }));

        let updateSucceeded = false;
        try {
            await runWithPendingLiveFields([field], async () => {
                // Use the optimized handler if provided
                if (onTicketUpdate) {
                    if (field === 'status_id') {
                        await onTicketUpdate(field, normalizedValue, {
                            propagateToChildren: propagationDecision.propagateToChildren,
                        });
                    } else {
                        await onTicketUpdate(field, normalizedValue);
                    }
                    updateSucceeded = true;
                    if (field === 'board_id') {
                        setSavedBoardId(normalizedValue);
                    }

                    // If we're changing the assigned_to field, we need to handle additional resources
                    // This will be handled by the container component and passed back in props
                } else {
                    // Fallback to the original implementation if no optimized handler is provided
                    const result = await updateTicket(ticket.ticket_id || '', { [field]: normalizedValue });
                    if (isReturnedActionError(result)) {
                        throw result;
                    }

                    if (result === 'success') {
                        updateSucceeded = true;
                        console.log(`${field} changed to: ${normalizedValue}`);
                        if (field === 'board_id') {
                            setSavedBoardId(normalizedValue);
                        }

                        // If we're changing the assigned_to field, refresh the additional resources
                        if (field === 'assigned_to') {
                            try {
                                // Refresh the additional resources
                                const resources = await getTicketResources(ticket.ticket_id!);
                                if (isReturnedActionError(resources)) {
                                    handleTicketActionError(resources, t('messages.updateTicketFailed', 'Failed to update ticket'));
                                    return;
                                }
                                setAdditionalAgents(resources);
                                console.log('Additional resources refreshed after assignment change');
                            } catch (resourceError) {
                                console.error('Error refreshing additional resources:', resourceError);
                            }
                        }
                    } else {
                        console.error(`Failed to update ticket ${field}`);
                        // Revert to previous value on failure
                        setTicket(prevTicket => ({ ...prevTicket, [field]: previousValue }));
                    }
                }
            });

            // A local field change (like a remote one) moves none of the grid
            // timeline's counters, so its "changed <field>" system row would never
            // appear until a full reload. Mirror the remote-update bump so the
            // local edit shows live. One bump per successful save (never on
            // error/revert).
            if (updateSucceeded) {
                setActivityLogRefreshKey((value) => value + 1);
                // Header "Updated <time> by <name>": local UI state only. The server
                // stamps updated_at/updated_by itself; browsers never send them.
                setTicket(prev => ({ ...prev, updated_at: new Date().toISOString() }));
                setUpdatedByUser(localActor);
                onSaved?.();
            }
        } catch (error) {
            console.error(`Error updating ticket ${field}:`, error);
            // Revert to previous value on error
            setTicket(prevTicket => ({ ...prevTicket, [field]: previousValue }));
            handleTicketActionError(error, t('messages.updateTicketFailed', 'Failed to update ticket'));
        }
    };

    const handleAssignTeam = useCallback(async (
        teamId: string,
        options?: TicketNotificationSuppressionValue
    ) => {
        // Optimistically update UI before server call
        const previousTicket = ticket;
        const previousTeam = team;
        const previousAgents = additionalAgents;

        const teamDetails = teams.find(t => t.team_id === teamId) || null;
        const assignedTo = ticket.assigned_to || teamDetails?.manager_id || ticket.assigned_to;

        setTicket(prevTicket => ({
            ...prevTicket,
            assigned_team_id: teamId,
            assigned_to: assignedTo
        }));
        if (teamDetails) {
            setTeam(teamDetails);
        }

        try {
            const result = await assignTeamToTicket(
                ticket.ticket_id || '',
                teamId,
                options?.suppressContactNotifications ? options : {}
            );
            if (isReturnedActionError(result)) {
                throw result;
            }
            // The assignment is durable; notify even if the follow-up fetches fail.
            onSaved?.();

            // If we didn't have team details from local state, fetch them
            if (!teamDetails) {
                const fetchedTeam = await getTeamById(teamId);
                if (isTeamActionError(fetchedTeam)) {
                    throw fetchedTeam;
                }
                setTeam(fetchedTeam || null);
            }

            if (ticket.ticket_id) {
                const resources = await getTicketResources(ticket.ticket_id);
                if (isReturnedActionError(resources)) {
                    throw resources;
                }
                setAdditionalAgents(resources);
            }

            toast.success(t('messages.teamAssignSuccess'));
        } catch (error) {
            console.error('Error assigning team:', error);
            // Revert on failure
            setTicket(previousTicket);
            setTeam(previousTeam);
            setAdditionalAgents(previousAgents);
            handleTicketActionError(error, t('messages.teamAssignFailed'));
        }
    }, [ticket, team, additionalAgents, teams, onSaved]);

    const handleRemoveTeamAssignment = useCallback(async (
        mode: 'remove_all' | 'keep_all' | 'selective',
        keepUserIds?: string[]
    ) => {
        try {
            const result = await removeTeamFromTicket(ticket.ticket_id || '', { mode, keepUserIds });
            if (isReturnedActionError(result)) {
                throw result;
            }

            onSaved?.();
            setTicket(prevTicket => ({
                ...prevTicket,
                assigned_team_id: null
            }));
            setTeam(null);

            if (ticket.ticket_id) {
                const resources = await getTicketResources(ticket.ticket_id);
                if (isReturnedActionError(resources)) {
                    throw resources;
                }
                setAdditionalAgents(resources);
            }

            toast.success(t('messages.teamRemoveSuccess'));
        } catch (error) {
            console.error('Error removing team assignment:', error);
            handleTicketActionError(error, t('messages.teamRemoveFailed'));
        }
    }, [ticket.ticket_id, onSaved]);

    const [editorKey, setEditorKey] = useState(0);
    const refreshTicketDocuments = useCallback(async () => {
        // A data source without documents has no native document rows for this
        // ticket id; the workspace-level document provider must not be asked.
        if (!ticket.ticket_id || !dataSource.capabilities.documents) return;

        try {
            const docs = await getDocumentByTicketId(ticket.ticket_id);
            if (isActionPermissionError(docs)) {
                console.warn('Permission denied while refreshing ticket documents', {
                    ticketId: ticket.ticket_id,
                    reason: docs.permissionError,
                });
                return;
            }
            setDocuments(docs || []);
        } catch (error) {
            console.error('Failed to refresh ticket documents:', error);
        }
    }, [ticket.ticket_id, dataSource.capabilities.documents]);

    const resetCommentDeleteState = useCallback(() => {
        setIsDeleteDialogOpen(false);
        setCommentToDelete(null);
        setIsDeletingComment(false);
    }, []);

    const handleAddNewComment = async (
        isInternal: boolean,
        isResolution: boolean,
        closeStatusId: string | null = null,
        options?: TicketNotificationSuppressionValue,
        schedule?: { publishAt: string; timeZone: string } | null,
        emailRecipients?: CommentEmailRecipientsPayload,
    ): Promise<boolean> => {
        // Check if content is empty
        const contentStr = JSON.stringify(newCommentContent);
        const hasContent = contentStr !== JSON.stringify([{
            type: "paragraph",
            props: {
                textAlignment: "left",
                backgroundColor: "default",
                textColor: "default"
            },
            content: [{
                type: "text",
                text: "",
                styles: {}
            }]
        }]);

        if (!hasContent) {
            console.log("Cannot add empty comment");
            return false;
        }
    
        try {
            if (!userId) {
                console.error("No valid user ID found");
                return false;
            }
            
            // Use the centralized utility to convert BlockNote content to markdown
            const markdownContent = await convertBlockNoteToMarkdown(newCommentContent);
            console.log("Converted markdown content:", markdownContent);
    
            // The resolution toggle is paired with an immediate close when a
            // close-status is selected and the ticket isn't already in that
            // status. Surface that intent to the server so the email
            // subscriber can suppress the duplicate comment email — the
            // close email will carry the resolution body.
            const willCloseTicket = Boolean(
                isResolution && closeStatusId && ticket.status_id !== closeStatusId
            );

            // Use the optimized handler if provided
            if (onAddComment) {
                const confirmed = await onAddComment(
                    JSON.stringify(newCommentContent),
                    isInternal,
                    isResolution,
                    willCloseTicket,
                    schedule,
                    emailRecipients,
                );
                // An unconfirmed publish (rejected or unknown outcome) has already been
                // reported by the handler; keep the composer and its draft intact.
                if (!confirmed) {
                    return false;
                }
                await refreshTicketDocuments();

                // Optimistically update the response state in UI to match server behavior:
                // - Internal note: no change
                // - Client-visible comment from internal user (MSP portal): awaiting client
                if (!isInternal && !schedule && responseStateTrackingEnabled) {
                    setTicket((prev: any) => ({
                        ...prev,
                        response_state: 'awaiting_client'
                    }));
                }

                // Refresh comments to ensure immediate UI update
                if (ticket.ticket_id) {
                    try {
                        const updatedComments = await findCommentsByTicketId(ticket.ticket_id);
                        if (isReturnedActionError(updatedComments)) {
                            handleTicketActionError(updatedComments, t('messages.loadCommentsFailed', 'Failed to load comments'));
                        } else {
                            setConversations(updatedComments);
                        }
                    } catch (e) {
                        console.error('Failed to refresh comments after add:', e);
                    }
                }

                // If this was a resolution note and a closed status was selected, close the ticket.
                if (!schedule && isResolution && closeStatusId && ticket.status_id !== closeStatusId) {
                    await closeTicketForResolution(closeStatusId, options);
                }

                // Reset the comment input
                setNewCommentContent([{
                    type: "paragraph",
                    props: {
                        textAlignment: "left",
                        backgroundColor: "default",
                        textColor: "default"
                    },
                    content: [{
                        type: "text",
                        text: "",
                        styles: {}
                    }]
                }]);
                // Remount the uncontrolled composer editor so the typed text
                // clears from view; resetting newCommentContent state alone does
                // not, since the editor only reads initialContent on mount.
                setEditorKey((k) => k + 1);

                onSaved?.();
                return true;
            } else {
                // Use the regular createComment action for MSP portal
                if (ticket.ticket_id && userId) {
                    // Call the regular comment creation action
                    const newComment = await createComment({
                        ticket_id: ticket.ticket_id,
                        note: JSON.stringify(newCommentContent),
                        is_internal: isInternal,
                        is_resolution: isResolution,
                        user_id: userId,
                        author_type: 'internal', // Will be overridden based on user type in the action
                        ...(schedule ? {
                            scheduled_publish_at: schedule.publishAt,
                            scheduled_publish_tz: schedule.timeZone,
                        } : {}),
                        // See email-subscriber suppression note above.
                        ...(willCloseTicket ? { metadata: { closes_ticket: true } } : {})
                    }, emailRecipients);
                    if (isReturnedActionError(newComment)) {
                        handleTicketActionError(newComment, t('messages.addCommentFailed', 'Failed to add comment'));
                        return false;
                    }
                    
                    if (newComment) {
                        await refreshTicketDocuments();
                        // Refresh comments after adding
                        const updatedComments = await findCommentsByTicketId(ticket.ticket_id);
                        if (isReturnedActionError(updatedComments)) {
                            handleTicketActionError(updatedComments, t('messages.loadCommentsFailed', 'Failed to load comments'));
                            return false;
                        }
                        setConversations(updatedComments);

                        if (isResolution && closeStatusId && ticket.status_id !== closeStatusId) {
                            setTicket((prev: any) => ({ ...prev, response_state: null }));
                            if (options?.suppressContactNotifications) {
                                await handleBatchSaveChanges({ status_id: closeStatusId }, options);
                            } else {
                                await handleSelectChange('status_id', closeStatusId);
                            }
                        }
                        
                        // Reset the comment input
                        setNewCommentContent([{
                            type: "paragraph",
                            props: {
                                textAlignment: "left",
                                backgroundColor: "default",
                                textColor: "default"
                            },
                            content: [{
                                type: "text",
                                text: "",
                                styles: {}
                            }]
                        }]);
                        // See note above: remount the composer editor to clear the view.
                        setEditorKey((k) => k + 1);
                        console.log("New note added successfully");
                        onSaved?.();
                        return true;
                    } else {
                        console.error('Failed to add comment');
                        return false;
                    }
                } else {
                    console.error('Ticket ID is missing');
                    return false;
                }
            }
        } catch (error) {
            console.error("Error adding new note:", error);
            handleTicketActionError(error, t('messages.addCommentFailed', 'Failed to add comment'));
            return false;
        }
    };

    const handleAddReplyComment = async (
        content: PartialBlock[],
        parentCommentId: string,
        isInternal: boolean,
        emailRecipients?: CommentEmailRecipientsPayload,
    ): Promise<boolean> => {
        const contentStr = JSON.stringify(content);
        const hasContent = contentStr !== JSON.stringify([{
            type: "paragraph",
            props: {
                textAlignment: "left",
                backgroundColor: "default",
                textColor: "default"
            },
            content: [{
                type: "text",
                text: "",
                styles: {}
            }]
        }]);

        if (!hasContent || !ticket.ticket_id || !userId) {
            return false;
        }

        try {
            const result = await createComment({
                ticket_id: ticket.ticket_id,
                note: contentStr,
                is_internal: isInternal,
                is_resolution: false,
                user_id: userId,
                author_type: 'internal',
                parent_comment_id: parentCommentId
            }, emailRecipients);
            if (isReturnedActionError(result)) {
                throw result;
            }

            onSaved?.();

            const updatedComments = await findCommentsByTicketId(ticket.ticket_id);
            if (isReturnedActionError(updatedComments)) {
                throw updatedComments;
            }
            setConversations(updatedComments);
            await refreshTicketDocuments();

            if (!isInternal && responseStateTrackingEnabled) {
                setTicket((prev: any) => ({
                    ...prev,
                    response_state: 'awaiting_client'
                }));
            }

            return true;
        } catch (error) {
            handleTicketActionError(error, t('messages.addCommentFailed', 'Failed to add comment'));
            return false;
        }
    };
    
    const handleEdit = (conversation: IComment) => {
        // Only allow users to edit their own comments
        if (userId === conversation.user_id) {
            setIsEditing(true);
            setCurrentComment(conversation);
        } else {
            toast.error(t('messages.editOwnCommentOnly'));
        }
    };

    const handleSave = async (updates: Partial<IComment>) => {
        if (!currentComment) return;

        // An existing comment becoming the resolution carries the same close
        // intent as the composer's resolution toggle, so offer that close once
        // the edit lands.
        const becameResolution = Boolean(updates.is_resolution) && !currentComment.is_resolution;

        try {
            // Extract plain text from the content for markdown
            const extractPlainText = (noteStr: string): string => {
                try {
                    const blocks = JSON.parse(noteStr);
                    return blocks.map((block: any) => {
                        if (!block.content) return '';
                        
                        if (Array.isArray(block.content)) {
                            return block.content
                                .filter((item: any) => item && item.type === 'text')
                                .map((item: any) => item.text || '')
                                .join('');
                        }
                        
                        if (typeof block.content === 'string') {
                            return block.content;
                        }
                        
                        return '';
                    }).filter((text: string) => text.trim() !== '').join('\n\n');
                } catch (e) {
                    console.error("Error parsing note JSON:", e);
                    return noteStr || "";
                }
            };
            
            // Extract markdown content directly if note is being updated
            if (updates.note) {
                const markdownContent = extractPlainText(updates.note);
                console.log("Extracted markdown content for update:", markdownContent);
                updates.markdown_content = markdownContent;
            }

            const updateResult = await updateComment(currentComment.comment_id!, updates);
            if (isReturnedActionError(updateResult)) {
                throw updateResult;
            }
            onSaved?.();
            await refreshTicketDocuments();

            const updatedCommentData = await findCommentById(currentComment.comment_id!);
            if (isReturnedActionError(updatedCommentData)) {
                throw updatedCommentData;
            }
            if (updatedCommentData) {
                setConversations(prevConversations =>
                    prevConversations.map((conv):IComment =>
                        conv.comment_id === updatedCommentData.comment_id ? updatedCommentData : conv
                    )
                );
            }

            setIsEditing(false);
            setCurrentComment(null);

            if (becameResolution && !currentStatusIsClosed && closedStatusOptions.length > 0) {
                setResolutionClosePrompt({
                    isOpen: true,
                    statusId: closedStatusOptions.length === 1 ? closedStatusOptions[0].value : null,
                    suppression: emptyNotificationSuppression(),
                });
            }
        } catch (error) {
            handleTicketActionError(error, t('messages.saveCommentFailed'));
        }
    };

    const closeResolutionClosePrompt = () => {
        setResolutionClosePrompt({ isOpen: false, statusId: null, suppression: emptyNotificationSuppression() });
    };

    const confirmResolutionClosePrompt = async () => {
        const closeStatusId = resolutionClosePrompt.statusId;
        if (!closeStatusId) return;
        const suppression = resolutionClosePrompt.suppression;
        setIsSubmittingResolutionClosePrompt(true);
        try {
            await closeTicketForResolution(
                closeStatusId,
                suppression.suppressContactNotifications ? suppression : undefined,
            );
            closeResolutionClosePrompt();
        } finally {
            setIsSubmittingResolutionClosePrompt(false);
        }
    };
const handleClose = () => {
    setIsEditing(false);
    setCurrentComment(null);
};



    // This function is no longer used directly - we use handleDeleteRequest instead
    // Keeping it for backward compatibility with other components that might use it
    const handleDelete = async (comment: IComment) => {
        if (!comment.comment_id) return;
        
        try {
            const result = await deleteComment(comment.comment_id);
            if (isReturnedActionError(result)) {
                throw result;
            }
            setConversations(prevConversations =>
                prevConversations.filter(conv => conv.comment_id !== comment.comment_id)
            );
            onSaved?.();
        } catch (error) {
            console.error("Error deleting comment:", error);
        }
    };

    const handleContentChange = useCallback((_blocks: PartialBlock[]) => {
        // Edit-mode comment content is owned by CommentItem local state and
        // persisted through handleSave. Avoid mutating currentComment on each
        // keystroke to prevent unnecessary TicketDetails rerenders.
    }, []);

    const handleUpdateDescription = async (content: string) => {
        try {
            // Use the optimized handler if provided
            if (onUpdateDescription) {
                const success = await onUpdateDescription(content);
                
                if (success) {
                    // Update the local ticket state
                    const currentAttributes = ticket.attributes || {};
                    const updatedAttributes = {
                        ...currentAttributes,
                        description: content
                    };
                    
                    setTicket(prev => ({
                        ...prev,
                        attributes: updatedAttributes,
                        updated_at: new Date().toISOString()
                    }));
                    setUpdatedByUser(localActor);
                    onSaved?.();
                }
                
                return success;
            } else {
                // Fallback to the original implementation
                if (!ticket.ticket_id) {
                    console.error('Ticket ID is missing');
                    return false;
                }

                // Update the ticket's attributes.description field
                const currentAttributes = ticket.attributes || {};
                const updatedAttributes = {
                    ...currentAttributes,
                    description: content
                };

                // Update the ticket
                const result = await updateTicket(ticket.ticket_id, {
                    attributes: updatedAttributes
                });
                if (isReturnedActionError(result)) {
                    throw result;
                }

                // Update the local ticket state
                setTicket(prev => ({
                    ...prev,
                    attributes: updatedAttributes,
                    updated_at: new Date().toISOString()
                }));
                setUpdatedByUser(localActor);


                toast.success(t('messages.descriptionUpdated'));
                onSaved?.();
                return true;
            }
        } catch (error) {
            handleTicketActionError(error, t('messages.updateDescriptionFailed'));
            return false;
        }
    };

    // A stopwatch Stop saved its entry (the session is logged server-side): refresh the time list.
    const handleStopwatchEntryLogged = useCallback(() => {
        setTimeEntriesRefreshKey((value) => value + 1);
    }, []);

    const handleAddTimeEntry = async () => {
        if (isLaunchingTimeEntryRef.current) {
            return;
        }
        isLaunchingTimeEntryRef.current = true;
        setIsLaunchingTimeEntry(true);
        try {
            if (!ticket.ticket_id) {
                toast.error(t('messages.ticketIdMissing'));
                return;
            }

            await launchTimeEntry({
                openDrawer,
                closeDrawer,
                context: buildTicketTimeEntryContext({
                    ticket,
                    workItem: resolveTicketTimeWorkItem(dataSource, ticket),
                    clientName: client?.client_name ?? null,
                    timeDescription,
                    masterTicketNumber: bundle?.masterTicket?.ticket_number ?? null,
                }),
                onComplete: () => {
                    setTimeEntriesRefreshKey((value) => value + 1);
                },
            });
        } catch (error) {
            handleTicketActionError(error, t('messages.prepareTimeEntryFailed'));
        } finally {
            isLaunchingTimeEntryRef.current = false;
            setIsLaunchingTimeEntry(false);
        }
    };

    const openScheduleEntryEditor = async (existingEntryId?: string) => {
        try {
            if (!ticket.ticket_id) {
                toast.error(t('messages.ticketIdMissing'));
                return;
            }

            await launchScheduleEntry({
                openDrawer,
                closeDrawer,
                context: buildScheduleContext(ticket.ticket_id),
                onComplete: () => setScheduleRefreshKey((value) => value + 1),
                existingEntryId,
            });
        } catch (error) {
            handleTicketActionError(error, t('messages.scheduleOpenFailed', { defaultValue: 'Failed to open the scheduler' }));
        }
    };

    const handleScheduleWork = () => openScheduleEntryEditor();
    const handleOpenScheduleEntry = (entryId: string) => openScheduleEntryEditor(entryId);

    const handleEditTimeEntry = async (entry: { entry_id: string }) => {
        try {
            if (!ticket.ticket_id) {
                toast.error(t('messages.ticketIdMissing'));
                return;
            }

            await launchTimeEntry({
                openDrawer,
                closeDrawer,
                context: buildTicketTimeEntryContext({
                    ticket,
                    workItem: resolveTicketTimeWorkItem(dataSource, ticket),
                    clientName: client?.client_name ?? null,
                    timeDescription: '',
                    masterTicketNumber: bundle?.masterTicket?.ticket_number ?? null,
                }),
                existingEntryId: entry.entry_id,
                onComplete: () => {
                    setTimeEntriesRefreshKey((value) => value + 1);
                },
            });
        } catch (error) {
            handleTicketActionError(error, t('messages.prepareTimeEntryFailed'));
        }
    };

    const handleRequestDeleteTimeEntry = (entry: { entry_id: string; user_name: string | null }) => {
        setPendingDeleteTimeEntry(entry);
    };

    useCatalogShortcut('record.addTime', () => { void handleAddTimeEntry(); });

    const handleConfirmDeleteTimeEntry = async () => {
        if (!pendingDeleteTimeEntry) return;
        setIsDeletingTimeEntry(true);
        try {
            const result = await deleteTimeEntry(pendingDeleteTimeEntry.entry_id);
            if (isReturnedActionError(result)) {
                handleTicketActionError(result, t('messages.deleteTimeEntryFailed', { defaultValue: 'Failed to delete time entry' }));
                return;
            }
            toast.success(t('messages.timeEntryDeleted', { defaultValue: 'Time entry deleted' }));
            setTimeEntriesRefreshKey((value) => value + 1);
        } catch (error) {
            handleTicketActionError(error, t('messages.deleteTimeEntryFailed', { defaultValue: 'Failed to delete time entry' }));
        } finally {
            setIsDeletingTimeEntry(false);
            setPendingDeleteTimeEntry(null);
        }
    };

    // Watcher writes go through TicketWatcherService-backed server actions; the
    // whole `attributes` object is never rewritten from here. The returned list is
    // applied to local display state only (the server already synced the mirror).
    const runWatcherAction = async (
        action: () => Promise<TicketWatchersResult | ActionMessageError | ActionPermissionError>
    ): Promise<boolean> => {
        if (!ticket.ticket_id || isWatchListSaving) {
            return false;
        }

        setIsWatchListSaving(true);
        try {
            const result = await action();
            if (isReturnedActionError(result)) {
                throw result;
            }

            const updatedAttributes = setTicketWatchListOnAttributes(
                ticket.attributes,
                result.watchers.map((watcher) => ({
                    email: watcher.email,
                    active: watcher.active,
                    name: watcher.name ?? undefined,
                    entity_type: watcher.entity_type ?? undefined,
                    entity_id: watcher.entity_id ?? undefined,
                    source: watcher.source ?? undefined,
                }))
            );
            setTicket((prevTicket) => ({
                ...prevTicket,
                attributes: updatedAttributes ?? null,
                updated_at: new Date().toISOString(),
            }));
            setUpdatedByUser(localActor);
            onSaved?.();
            return true;
        } catch (error) {
            console.error('Error updating watch list:', error);
            handleTicketActionError(error, t('messages.watchListUpdateFailed'));
            return false;
        } finally {
            setIsWatchListSaving(false);
        }
    };

    const handleAddWatchers = (inputs: AddTicketWatcherInput[]) =>
        runWatcherAction(() => addTicketWatchers(ticket.ticket_id!, inputs));
    const handleSetWatcherActive = (email: string, active: boolean) =>
        runWatcherAction(() => setTicketWatcherActive(ticket.ticket_id!, email, active));
    const handleRemoveWatcher = (email: string) =>
        runWatcherAction(() => removeTicketWatcher(ticket.ticket_id!, email));

    const handleLoadAllContactsForWatchList = useCallback(async () => {
        if (allContactsForWatchListLoading || allContactsForWatchList.length > 0) {
            return;
        }

        setAllContactsForWatchListLoading(true);
        try {
            const allContacts = await getAllActiveContacts('asc');
            setAllContactsForWatchList(allContacts || []);
        } catch (error) {
            console.error('Error loading all contacts for watch list:', error);
            toast.error(t('messages.loadAllContactsFailed'));
        } finally {
            setAllContactsForWatchListLoading(false);
        }
    }, [allContactsForWatchList.length, allContactsForWatchListLoading]);

    const handleChangeContact = () => {
        setIsChangeContactDialogOpen(true);
    };

    const handleChangeClient = () => {
        setIsChangeClientDialogOpen(true);
    };

    const handleTagsChange = (updatedTags: ITag[]) => {
        setTags(updatedTags);
    };

    // Changing the contact is a ticket update that notifies the contact, assignee
    // and watchers, so it asks the same notification question status changes do.
    const [contactChangePrompt, setContactChangePrompt] = useState<{
        isOpen: boolean;
        contactId: string | null;
        suppression: TicketNotificationSuppressionValue;
    }>({ isOpen: false, contactId: null, suppression: emptyNotificationSuppression() });
    const [isSubmittingContactChange, setIsSubmittingContactChange] = useState(false);

    const handleContactChange = async (newContactId: string | null) => {
        if ((ticket.contact_name_id ?? null) === newContactId) {
            setIsChangeContactDialogOpen(false);
            return;
        }
        setContactChangePrompt({ isOpen: true, contactId: newContactId, suppression: emptyNotificationSuppression() });
    };

    const applyContactChange = async (
        newContactId: string | null,
        suppression?: TicketNotificationSuppressionValue,
    ) => {
        try {
            await runWithPendingLiveFields(['contact_name_id'], async () => {
                const result = await updateTicket(
                    ticket.ticket_id!,
                    { contact_name_id: newContactId },
                    suppression?.suppressContactNotifications ? suppression : undefined,
                );
                if (isReturnedActionError(result)) {
                    throw result;
                }
                return result;
            });

            // Header "Updated … by …": local UI state only; the server stamps the row.
            setTicket(prev => ({ ...prev, updated_at: new Date().toISOString() }));
            setUpdatedByUser(localActor);
            onSaved?.();

            if (newContactId) {
                const contactData = await getContactByContactNameId(newContactId);
                setContactInfo(contactData);
            } else {
                setContactInfo(null);
            }

            setIsChangeContactDialogOpen(false);
            toast.success(t('messages.contactUpdated'));
        } catch (error) {
            handleTicketActionError(error, t('messages.updateContactFailed'));
        }
    };

    const closeContactChangePrompt = () => {
        setContactChangePrompt({ isOpen: false, contactId: null, suppression: emptyNotificationSuppression() });
    };

    const confirmContactChangePrompt = async () => {
        setIsSubmittingContactChange(true);
        try {
            await applyContactChange(contactChangePrompt.contactId, contactChangePrompt.suppression);
            closeContactChangePrompt();
        } finally {
            setIsSubmittingContactChange(false);
        }
    };

    const handleItilFieldChange = async (field: string, value: any) => {
        try {
            // First update local state immediately for UI responsiveness
            switch (field) {
                case 'itil_impact':
                    setItilImpact(value);
                    break;
                case 'itil_urgency':
                    setItilUrgency(value);
                    break;
                // NOTE: itil_category and itil_subcategory are now handled by unified CategoryPicker
            }

            // Create update object with the specific ITIL field
            const updateData: any = {};
            updateData[field] = value;

            // If we're updating impact or urgency, calculate the new ITIL priority
            if (field === 'itil_impact' || field === 'itil_urgency') {
                const currentImpact = field === 'itil_impact' ? value : itilImpact;
                const currentUrgency = field === 'itil_urgency' ? value : itilUrgency;

                // NOTE: Priority mapping is now handled in the backend
                // The backend will calculate and map ITIL priority to the correct priority_id
            }

            // NOTE: Category management is now unified through the CategoryPicker

            await runWithPendingLiveFields([field], async () => {
                const result = await updateTicketWithCache(ticket.ticket_id!, updateData);
                if (isReturnedActionError(result)) {
                    throw result;
                }
                return result;
            });

            // Update local ticket state to reflect the change
            setTicket(prevTicket => ({
                ...prevTicket,
                ...updateData,
                updated_at: new Date().toISOString()
            }));
            setUpdatedByUser(localActor);
            onSaved?.();

            if (field === 'itil_impact') {
                toast.success(t('messages.itilImpactUpdated'));
            } else if (field === 'itil_urgency') {
                toast.success(t('messages.itilUrgencyUpdated'));
            }
        } catch (error) {
            if (field === 'itil_urgency') {
                handleTicketActionError(error, t('messages.itilUrgencyUpdateFailed'));
            } else {
                handleTicketActionError(error, t('messages.itilImpactUpdateFailed'));
            }
        }
    };

    // Handler for batch save changes from TicketInfo
    const handleBatchSaveChanges = useCallback(async (
        changes: Record<string, unknown>,
        options?: TicketNotificationSuppressionValue,
    ): Promise<boolean> => {
        const targetStatusId = typeof changes.status_id === 'string' ? changes.status_id : null;

        if (targetStatusId && ticket.ticket_id) {
            try {
                const check = await checkTicketClosure(ticket.ticket_id, targetStatusId);
                if (check.wouldClose && !check.allowed) {
                    setCloseOverrideReason('');
                    setCloseBlockedDialog({
                        isOpen: true,
                        statusId: targetStatusId,
                        failures: check.failures,
                        canOverride: check.canOverride,
                        suppression: options ?? null,
                    });
                    return false;
                }
            } catch (checkError) {
                // Fall through to the write; the server still enforces.
                console.error('Close rules pre-check failed:', checkError);
            }
        }

        // If we have a batch handler from container, use it
        if (onBatchTicketUpdate) {
            let propagateToChildren: boolean | undefined;
            if (targetStatusId && ticket.ticket_id) {
                const propagationDecision = await confirmBundlePropagation(targetStatusId);
                if (!propagationDecision.proceed) {
                    return false;
                }
                propagateToChildren = propagationDecision.propagateToChildren;
            }
            const batchOptions = propagateToChildren === undefined
                ? options
                : { ...(options ?? {}), propagateToChildren };
            const success = await runWithPendingLiveFields(Object.keys(changes), () => onBatchTicketUpdate(changes, batchOptions));
            if (success) {
                // Update local ticket state with the saved changes
                setTicket(prevTicket => ({
                    ...prevTicket,
                    ...changes,
                    updated_at: new Date().toISOString()
                }));
                setUpdatedByUser(localActor);
                // Refetch the grid timeline so the "changed <field>" system rows
                // from this local batch appear live (single bump per batch). The
                // individual-save fallback below relies on handleSelectChange,
                // which bumps per field on its own.
                setActivityLogRefreshKey((value) => value + 1);
                onSaved?.();
            }
            return success;
        }

        // Fallback: save each change individually
        try {
            const entries = Object.entries(changes);
            const itilEntries = entries.filter(([field]) => field === 'itil_impact' || field === 'itil_urgency');
            const ticketEntries = entries.filter(([field]) => field !== 'itil_impact' && field !== 'itil_urgency');

            // Per-field saves can't carry suppression flags; write the ticket
            // fields in one mirror-action call so the flags reach the event.
            if (options?.suppressContactNotifications && ticketEntries.length > 0) {
                const ticketChanges = Object.fromEntries(ticketEntries) as Partial<ITicket>;
                const result = await runWithPendingLiveFields(
                    ticketEntries.map(([field]) => field),
                    () => updateTicket(ticket.ticket_id || '', ticketChanges, options)
                );
                if (result !== 'success') {
                    return false;
                }
                setTicket(prevTicket => ({
                    ...prevTicket,
                    ...ticketChanges,
                    updated_at: new Date().toISOString()
                }));
                setUpdatedByUser(localActor);
                setActivityLogRefreshKey((value) => value + 1);
                for (const [field, value] of itilEntries) {
                    await handleItilFieldChange(field, value);
                }
                onSaved?.();
                return true;
            }

            for (const [field, value] of entries) {
                if (field === 'itil_impact' || field === 'itil_urgency') {
                    await handleItilFieldChange(field, value);
                } else {
                    await handleSelectChange(field as keyof ITicket, value as string | null);
                }
            }
            return true;
        } catch (error) {
            console.error('Error in batch save:', error);
            return false;
        }
    }, [
        confirmBundlePropagation,
        handleItilFieldChange,
        handleSelectChange,
        localActor,
        onBatchTicketUpdate,
        runWithPendingLiveFields,
        ticket.ticket_id,
    ]);

    // Shared by the composer's resolution toggle and the edit-to-resolution
    // close prompt: mirror handleSelectChange's pre-close check so unmet close
    // rules open the override dialog (carrying the suppression choice) instead
    // of a generic failure.
    const closeTicketForResolution = useCallback(async (
        closeStatusId: string,
        options?: TicketNotificationSuppressionValue,
    ): Promise<void> => {
        if (options?.suppressContactNotifications) {
            let closeBlocked = false;
            if (ticket.ticket_id) {
                try {
                    const check = await checkTicketClosure(ticket.ticket_id, closeStatusId);
                    if (check.wouldClose && !check.allowed) {
                        closeBlocked = true;
                        setCloseOverrideReason('');
                        setCloseBlockedDialog({
                            isOpen: true,
                            statusId: closeStatusId,
                            failures: check.failures,
                            canOverride: check.canOverride,
                            suppression: options,
                        });
                    }
                } catch (checkError) {
                    // Fall through to the write; the server still enforces.
                    console.error('Close rules pre-check failed:', checkError);
                }
            }
            if (!closeBlocked) {
                // Backend clears response_state when closing; keep UI consistent.
                setTicket((prev: any) => ({ ...prev, response_state: null }));
                const closed = await handleBatchSaveChanges({ status_id: closeStatusId }, options);
                if (!closed) {
                    toast.error(t('messages.closeFailed', 'Failed to close ticket'));
                }
            }
        } else {
            // Backend clears response_state when closing; keep UI consistent.
            setTicket((prev: any) => ({ ...prev, response_state: null }));
            await handleSelectChange('status_id', closeStatusId);
        }
    }, [handleBatchSaveChanges, handleSelectChange, t, ticket.ticket_id]);

    const handleResolveAndClose = useCallback(async (
        statusId: string,
        contentBlocks: PartialBlock[],
        suppression: TicketNotificationSuppressionValue,
        isInternal: boolean = false,
        emailRecipients?: CommentEmailRecipientsPayload,
    ) => {
        if (!ticket.ticket_id || !closedStatusOptions.some((option) => option.value === statusId)) {
            toast.error(t('messages.closeFailed', 'Failed to close ticket'));
            return false;
        }

        setIsSubmittingResolutionClose(true);
        let resolutionSaved = false;
        // Fires onSaved: the resolution comment is durable, or the status write
        // landed on the no-comment path. Either way the list row is stale.
        let ticketChanged = false;
        try {
            // A resolution is optional; an empty editor must not insert a blank
            // comment, so the close runs on its own.
            if (hasEditorContent(contentBlocks)) {
                const resolutionAdded = await addResolutionComment(
                    JSON.stringify(contentBlocks),
                    suppression,
                    isInternal,
                    emailRecipients,
                );
                if (!resolutionAdded) {
                    return false;
                }
                resolutionSaved = true;
                ticketChanged = true;
            }

            // Any comment is already durable at this point. Close this dialog
            // so a failed or blocked status write cannot accidentally create a
            // duplicate resolution on resubmit.
            setIsResolutionCloseDialogOpen(false);

            try {
                const check = await checkTicketClosure(ticket.ticket_id, statusId);
                if (check.wouldClose && !check.allowed) {
                    setCloseOverrideReason('');
                    setCloseBlockedDialog({
                        isOpen: true,
                        statusId,
                        failures: check.failures,
                        canOverride: check.canOverride,
                        suppression: suppression.suppressContactNotifications ? suppression : null,
                    });
                    return true;
                }
            } catch (checkError) {
                // Fall through to the write; the server still enforces.
                console.error('Close rules check failed after adding resolution:', checkError);
            }

            // Any resolution comment is durable; ask about bundle propagation
            // before the status write. Cancelling leaves the ticket open (the
            // comment stays, as before).
            const propagationDecision = await confirmBundlePropagation(statusId);
            if (!propagationDecision.proceed) {
                return resolutionSaved;
            }
            setIsSubmittingBundlePropagation(true);

            const result = await runWithPendingLiveFields(
                ['status_id', 'response_state'],
                () => updateTicketWithCache(
                    ticket.ticket_id!,
                    { status_id: statusId },
                    {
                        ...(suppression.suppressContactNotifications ? suppression : {}),
                        propagateToChildren: propagationDecision.propagateToChildren,
                    },
                ),
            );
            if (isReturnedActionError(result)) {
                throw result;
            }
            ticketChanged = true;

            setTicket((previousTicket) => ({
                ...previousTicket,
                status_id: statusId,
                response_state: null,
                updated_at: new Date().toISOString(),
            }));
            setUpdatedByUser(localActor);
            setActivityLogRefreshKey((value) => value + 1);
            toast.success(t('messages.ticketClosed', 'Ticket closed'));
            return true;
        } catch (error) {
            handleTicketActionError(error, t('messages.closeFailed', 'Failed to close ticket'));
            return resolutionSaved;
        } finally {
            // The resolution comment is durable once saved, even when the status
            // write was blocked, cancelled or failed, so the list row is stale
            // in every such case. Single call covers all exits.
            if (ticketChanged) {
                onSaved?.();
            }
            setIsSubmittingResolutionClose(false);
            setIsSubmittingBundlePropagation(false);
        }
    }, [addResolutionComment, closedStatusOptions, confirmBundlePropagation, localActor, onSaved, runWithPendingLiveFields, t, ticket.ticket_id]);

    const handleClientChange = async (newClientId: string) => {
        try {
            await runWithPendingLiveFields(['client_id', 'contact_name_id', 'location_id'], async () => {
                const result = await updateTicket(ticket.ticket_id!, {
                    client_id: newClientId,
                    contact_name_id: null, // Reset contact when client changes
                    location_id: null // Reset location when client changes
                });
                if (isReturnedActionError(result)) {
                    throw result;
                }
                return result;
            });
            // The client change is durable; notify even if follow-up fetches fail.
            onSaved?.();
            
            const [clientData, contactsData, locationData] = await Promise.all([
                getClientById(newClientId),
                getContactsByClient(newClientId),
                getClientLocations(newClientId),
            ]);
            
            setTicket(prevTicket => ({ ...prevTicket, updated_at: new Date().toISOString() }));
            setUpdatedByUser(localActor);
            setClient(clientData);
            setContacts(contactsData || []);
            setLocations(locationData || []);
            setContactInfo(null); // Reset contact info

            setIsChangeClientDialogOpen(false);
            toast.success(t('messages.clientUpdated'));
        } catch (error) {
            handleTicketActionError(error, t('messages.updateClientFailed'));
        }
    };
    
    const handleLocationChange = async (newLocationId: string | null) => {
        try {
            await runWithPendingLiveFields(['location_id'], async () => {
                const result = await updateTicket(ticket.ticket_id!, {
                    location_id: newLocationId
                });
                if (isReturnedActionError(result)) {
                    throw result;
                }
                return result;
            });
            
            // Update the ticket state with the new location
            setTicket(prevTicket => ({
                ...prevTicket,
                location_id: newLocationId,
                location: newLocationId ? locations.find(l => l.location_id === newLocationId) : undefined,
                updated_at: new Date().toISOString()
            }));
            setUpdatedByUser(localActor);
            onSaved?.();

            toast.success(t('messages.locationUpdated'));
        } catch (error) {
            handleTicketActionError(error, t('messages.updateLocationFailed'));
        }
    };

    const handleBillingProfileChange = async (newBillingProfileId: string | null) => {
        try {
            const result = await updateTicket(ticket.ticket_id!, {
                billing_profile_id: newBillingProfileId
            });
            if (isReturnedActionError(result)) {
                throw result;
            }

            setTicket(prevTicket => ({
                ...prevTicket,
                billing_profile_id: newBillingProfileId,
                updated_at: new Date().toISOString()
            }));
            setUpdatedByUser(localActor);
            onSaved?.();

            toast.success(t('messages.billingProfileUpdated', 'Billing profile updated'));
        } catch (error) {
            handleTicketActionError(error, t('messages.updateBillingProfileFailed', 'Failed to update billing profile'));
        }
    };

    const handleDeleteRequest = (conversation: IComment) => {
        // Only allow users to delete their own comments
        if (userId === conversation.user_id) {
            setCommentToDelete({
                commentId: conversation.comment_id!,
                imageDocuments: resolveCommentReferencedImageDocuments(conversation.note, documents),
            });
            setIsDeleteDialogOpen(true);
        } else {
            toast.error(t('messages.deleteOwnCommentError'));
        }
    };

    const handleDeleteConfirm = async (deleteImages: boolean) => {
        if (!commentToDelete) return;

        setIsDeletingComment(true);
        try {
            const result = await deleteComment(commentToDelete.commentId);
            if (isReturnedActionError(result)) {
                throw result;
            }
            setConversations(prevConversations =>
                prevConversations.filter(conv => conv.comment_id !== commentToDelete.commentId)
            );
            onSaved?.();

            if (deleteImages && commentToDelete.imageDocuments.length > 0 && ticket.ticket_id) {
                try {
                    const result = await deleteDraftClipboardImages({
                        ticketId: ticket.ticket_id,
                        documentIds: commentToDelete.imageDocuments.map((document) => document.documentId),
                        deleteDocumentFn: deleteDocument,
                    });

                    const deletedCount = result.deletedDocumentIds.length;
                    const failedCount = result.failures.length;

                    if (deletedCount > 0) {
                        await refreshTicketDocuments();
                    }

                    if (failedCount > 0) {
                        toast.error(t('messages.pastedImageDeleteFailed', { count: failedCount }));
                    } else if (deletedCount > 0) {
                        toast.success(t('messages.commentWithImagesDeleted', { count: deletedCount }));
                    } else {
                        toast.success(t('messages.commentDeleteSuccess'));
                    }
                } catch (imageDeleteError) {
                    console.error('Failed to delete pasted images during comment deletion:', imageDeleteError);
                    toast.error(t('messages.pastedImagesDeleteFailed'));
                }
            } else {
                toast.success(t('messages.commentDeleteSuccess'));
            }
        } catch (error) {
            handleTicketActionError(error, t('messages.deleteCommentFailed'));
        } finally {
            resetCommentDeleteState();
        }
    };

    const deleteDialogImageCount = commentToDelete?.imageDocuments.length ?? 0;
    const deleteDialogHasImages = deleteDialogImageCount > 0;
    const deleteDialogMessage = deleteDialogHasImages
        ? t('messages.deleteCommentWithImages', {
            defaultValue: 'This comment includes {{count}} pasted images that were uploaded as ticket documents. Delete the comment only, or also delete the pasted images permanently?',
            count: deleteDialogImageCount,
          })
        : t('messages.deleteCommentConfirm', 'Are you sure you want to delete this comment? This action cannot be undone.');

    // Function to open ticket in a new window
    const openTicketInNewWindow = useCallback(() => {
        if (ticket.ticket_id) {
            window.open(`/msp/tickets/${ticket.ticket_id}`, '_blank');
        }
    }, [ticket.ticket_id]);

    const handleRemoveChildFromBundle = useCallback(async (childTicketId: string) => {
        try {
            const result = await removeChildFromBundleAction({ childTicketId });
            if (isReturnedActionError(result)) {
                handleTicketActionError(result, t('messages.removeFromBundleFailed'));
                return;
            }
            toast.success(t('messages.removedFromBundle'));
            onSaved?.();
            refreshScreen();
        } catch (error) {
            handleTicketActionError(error, t('messages.removeFromBundleFailed'));
        }
    }, [refreshScreen, onSaved, t]);

    const handleUnbundleMaster = useCallback(async () => {
        if (!ticket.ticket_id) return;
        try {
            const result = await unbundleMasterTicketAction({ masterTicketId: ticket.ticket_id });
            if (isReturnedActionError(result)) {
                handleTicketActionError(result, t('messages.unbundleFailed'));
                return;
            }
            toast.success(t('messages.bundleRemoved'));
            onSaved?.();
            refreshScreen();
        } catch (error) {
            handleTicketActionError(error, t('messages.unbundleFailed'));
        }
    }, [ticket.ticket_id, refreshScreen, onSaved, t]);

    const performAddChildToBundle = useCallback(async (childTicketId: string, onClosedMaster?: ClosedMasterChoice) => {
        if (!ticket.ticket_id) return;
        const result = await addChildrenToBundleAction({
            masterTicketId: ticket.ticket_id,
            childTicketIds: [childTicketId],
            ...(onClosedMaster ? { onClosedMaster } : {}),
        });
        if (isReturnedActionError(result)) {
            toast.error(getErrorMessage(result));
            return;
        }
        toast.success(t('messages.addedToBundle'));
        onSaved?.();
        setAddChildTicketNumber('');
        resetChildTicketPickerState();
        refreshScreen();
    }, [ticket.ticket_id, t, refreshScreen, resetChildTicketPickerState, onSaved]);

    // Fetch the master's closed context before linking. An open master links
    // straight away; a closed master must go through the explicit choice
    // dialog so the link never silently succeeds.
    const beginAddChildToBundle = useCallback(async (childTicketId: string) => {
        if (!ticket.ticket_id) return;
        setIsLoadingClosedMasterContext(true);
        try {
            const context = await getBundleMasterClosedContextAction({ masterTicketId: ticket.ticket_id });
            if (isReturnedActionError(context)) {
                toast.error(getErrorMessage(context));
                return;
            }
            if (!context.isClosed) {
                await performAddChildToBundle(childTicketId);
                return;
            }
            setClosedMasterContext(context);
            setClosedMasterChoice(
                context.allowedChoices.includes('keep_closed')
                    ? 'keep_closed'
                    : (context.allowedChoices[0] ?? null)
            );
            setPendingClosedMasterChildId(childTicketId);
            setIsClosedMasterChoiceOpen(true);
        } catch (error) {
            handleTicketActionError(error, t('messages.addToBundleFailed'));
        } finally {
            setIsLoadingClosedMasterContext(false);
        }
    }, [ticket.ticket_id, t, performAddChildToBundle]);

    const handleAddChildToBundle = useCallback(async () => {
        if (!ticket.ticket_id) return;
        const normalized = addChildTicketNumber.trim();
        if (!normalized) return;

        // Check if we have a selected ticket from search results
        if (selectedChildTicket && selectedChildTicket.ticket_number === normalized) {
            // Use the selected ticket from search
            if (ticket.client_id && selectedChildTicket.client_id && selectedChildTicket.client_id !== ticket.client_id) {
                setPendingChildToAdd({
                    ticket_id: selectedChildTicket.ticket_id,
                    ticket_number: normalized,
                    client_id: selectedChildTicket.client_id
                });
                setIsAddChildMultiClientConfirmOpen(true);
                return;
            }
            await beginAddChildToBundle(selectedChildTicket.ticket_id);
            return;
        }

        // Fallback: search by exact ticket number
        try {
            const found = await findTicketByNumberAction({ ticketNumber: normalized });
            if (isReturnedActionError(found)) {
                handleTicketActionError(found, t('messages.addToBundleFailed'));
                return;
            }
            if (!found) {
                toast.error(t('messages.ticketNotFound'));
                return;
            }
            if (found.ticket_id === ticket.ticket_id) {
                toast.error(t('messages.cannotAddMasterAsChild'));
                return;
            }
            if (found.master_ticket_id) {
                toast.error(t('messages.ticketAlreadyBundled'));
                return;
            }

            if (ticket.client_id && found.client_id && found.client_id !== ticket.client_id) {
                setPendingChildToAdd(found);
                setIsAddChildMultiClientConfirmOpen(true);
                return;
            }

            await beginAddChildToBundle(found.ticket_id);
        } catch (error) {
            handleTicketActionError(error, t('messages.addToBundleFailed'));
        }
    }, [ticket.ticket_id, ticket.client_id, addChildTicketNumber, selectedChildTicket, beginAddChildToBundle]);

    const bundleHasMultipleClients = useMemo(() => {
        if (!bundle?.isBundleMaster || !Array.isArray(bundle.children)) return false;
        const ids = new Set<string>();
        if (ticket.client_id) ids.add(ticket.client_id);
        for (const child of bundle.children) {
            if (child?.client_id) ids.add(child.client_id);
        }
        return ids.size > 1;
    }, [bundle?.isBundleMaster, bundle?.children, ticket.client_id]);

    // Debounced search for eligible child tickets
    const performSearch = useCallback(async (query: string) => {
        const normalizedQuery = query.trim();
        if (!ticket.board_id || !normalizedQuery) {
            setSearchResults([]);
            return;
        }

        const searchSeq = ++childTicketSearchSeqRef.current;
        setIsSearching(true);
        try {
            const results = await searchEligibleChildTicketsAction({
                boardId: ticket.board_id,
                searchQuery: normalizedQuery,
                excludeTicketId: ticket.ticket_id,
                limit: 10
            });
            if (searchSeq !== childTicketSearchSeqRef.current) return;
            if (isReturnedActionError(results)) {
                setSearchResults([]);
                toast.error(getErrorMessage(results));
                return;
            }
            setSearchResults(results);
        } catch (error) {
            console.error('Failed to search tickets:', error);
            if (searchSeq !== childTicketSearchSeqRef.current) return;
            setSearchResults([]);
        } finally {
            if (searchSeq === childTicketSearchSeqRef.current) {
                setIsSearching(false);
            }
        }
    }, [ticket.board_id, ticket.ticket_id]);

    const debouncedSearch = useCallback((query: string) => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
        }

        if (!query.trim()) {
            cancelChildTicketSearch();
            setSearchResults([]);
            setShowSearchResults(false);
            return;
        }

        searchTimeoutRef.current = setTimeout(() => {
            performSearch(query);
        }, 300); // 300ms debounce
    }, [performSearch, cancelChildTicketSearch]);

    const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAddChildTicketNumber(value);
        // Clear selected ticket if input doesn't match the selected ticket number
        if (selectedChildTicket && value !== selectedChildTicket.ticket_number) {
            setSelectedChildTicket(null);
        }
        setShowSearchResults(true);
        debouncedSearch(value);
    }, [debouncedSearch, selectedChildTicket]);

    const handleSelectSearchResult = useCallback((selectedTicket: EligibleChildTicket) => {
        cancelChildTicketSearch();
        setAddChildTicketNumber(selectedTicket.ticket_number);
        setSelectedChildTicket({
            ticket_id: selectedTicket.ticket_id,
            client_id: selectedTicket.client_id,
            ticket_number: selectedTicket.ticket_number
        });
        setShowSearchResults(false);
        setSearchResults([]);
    }, [cancelChildTicketSearch]);

    // Handle click outside to close search results
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
                setShowSearchResults(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    const handlePromoteChildToMaster = useCallback(async (childTicketId: string) => {
        if (!ticket.ticket_id) return;
        try {
            const result = await promoteBundleMasterAction({ oldMasterTicketId: ticket.ticket_id, newMasterTicketId: childTicketId });
            if (isReturnedActionError(result)) {
                handleTicketActionError(result, t('messages.promoteMasterFailed'));
                return;
            }
            toast.success(t('messages.promotedMaster'));
            onSaved?.();
            router.push(`/msp/tickets/${childTicketId}`);
            refreshScreen();
        } catch (error) {
            handleTicketActionError(error, t('messages.promoteMasterFailed'));
        }
    }, [ticket.ticket_id, router, refreshScreen, onSaved, t]);

    const performBundleModeChange = useCallback(async (
        nextMode: 'link_only' | 'sync_updates',
        onClosedMaster?: ClosedMasterChoice,
    ) => {
        if (!ticket.ticket_id) return;
        try {
            setIsUpdatingBundleSettings(true);
            const result = await updateBundleSettingsAction({
                masterTicketId: ticket.ticket_id,
                mode: nextMode,
                ...(onClosedMaster ? { onClosedMaster } : {}),
            });
            if (isReturnedActionError(result)) {
                handleTicketActionError(result, t('messages.updateBundleSettingsFailed'));
                return;
            }
            toast.success(t('messages.bundleSettingsUpdated'));
            onSaved?.();
            refreshScreen();
        } catch (error) {
            handleTicketActionError(error, t('messages.updateBundleSettingsFailed'));
        } finally {
            setIsUpdatingBundleSettings(false);
        }
    }, [ticket.ticket_id, refreshScreen, onSaved, t]);

    // Switching to sync_updates on a closed master needs the same explicit
    // choice as adding a child to one, so the closed-master dialog is reused.
    const handleToggleBundleMode = useCallback(async () => {
        if (!ticket.ticket_id || !bundle?.isBundleMaster) return;
        const nextMode = bundle.mode === 'link_only' ? 'sync_updates' : 'link_only';
        if (nextMode === 'link_only') {
            await performBundleModeChange(nextMode);
            return;
        }
        try {
            setIsUpdatingBundleSettings(true);
            const context = await getBundleMasterClosedContextAction({ masterTicketId: ticket.ticket_id });
            if (isReturnedActionError(context)) {
                handleTicketActionError(context, t('messages.updateBundleSettingsFailed'));
                return;
            }
            if (!context.isClosed) {
                setIsUpdatingBundleSettings(false);
                await performBundleModeChange(nextMode);
                return;
            }
            setClosedMasterContext(context);
            setClosedMasterChoice(
                context.allowedChoices.includes('keep_closed')
                    ? 'keep_closed'
                    : (context.allowedChoices[0] ?? null)
            );
            setPendingClosedMasterChildId(null);
            setIsModeSwitchPending(true);
            setIsClosedMasterChoiceOpen(true);
        } catch (error) {
            handleTicketActionError(error, t('messages.updateBundleSettingsFailed'));
        } finally {
            setIsUpdatingBundleSettings(false);
        }
    }, [ticket.ticket_id, bundle?.isBundleMaster, bundle?.mode, t, performBundleModeChange]);

    if (!tenant) {
        return (
            <div id="ticket-error-message" className="p-4">
                {t('info.tenantNotDefined', 'Error: tenant is not defined')}
            </div>
        );
    }

    const livePresenceUsers = ticketLive.presence.map((user) => ({
        id: user.userId,
        name: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
        color: user.color,
    }));

    const connectionStatusLabel = ticketLive.connectionStatus === 'reconnecting'
        ? t('liveUpdates.connection.reconnecting', 'Live updates offline — reconnecting…')
        : ticketLive.connectionStatus === 'unavailable'
            ? t('liveUpdates.connection.unavailable', 'Live updates unavailable')
            : null;

    // Children lock their workflow fields only under a sync_updates master;
    // bundle.mode is the master's ticket_bundle_settings.mode from the detail load.
    const bundleWorkflowLocked = isChildWorkflowLocked({
        isBundledChild: Boolean(bundle?.isBundleChild),
        masterSettings: { mode: bundle?.mode },
    });

    const bundleAndCloseBanners = (
        <>
                                {bundle?.isBundleChild && bundle?.masterTicket ? (
                                    <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-4 py-2 text-sm text-amber-900 dark:text-amber-200" id="ticket-bundle-child-banner">
                                        This ticket is bundled under{' '}
                                        <a className="font-medium underline" href={`/msp/tickets/${bundle.masterTicket.ticket_id}`}>
                                            {bundle.masterTicket.ticket_number}
                                        </a>
                                        .{' '}
                                        {bundleWorkflowLocked
                                            ? t('details.bundle.childLockedNotice', 'Workflow fields are locked; work from the master ticket.')
                                            : t('details.bundle.childLinkedNotice', 'It is linked to the master and managed on its own.')}
                                    </div>
                                ) : null}

                                {bundle?.isBundleMaster ? (
                                    <div className="mb-3 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 px-4 py-2 text-sm text-indigo-900 dark:text-indigo-200" id="ticket-bundle-master-banner">
                                        {t('details.bundle.masterBanner', 'This ticket is the master of a bundle ({{count}} children). Mode: {{mode}}.', {
                                            count: Array.isArray(bundle.children) ? bundle.children.length : 0,
                                            mode: (bundle.mode || 'sync_updates').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
                                        })}
                                        {bundleHasMultipleClients ? (
                                            <span className="ml-2 inline-flex items-center rounded bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">
                                                {t('details.bundle.multipleClients', 'Multiple clients')}
                                            </span>
                                        ) : null}
                                        {ticket.is_closed && (bundle?.openChildrenCount ?? 0) > 0 ? (
                                            <span
                                                id="ticket-bundle-master-open-children-badge"
                                                className="ml-2 inline-flex items-center rounded bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200"
                                            >
                                                {t('details.bundle.openChildrenBadge', '{{count}} open children', { count: bundle?.openChildrenCount ?? 0 })}
                                            </span>
                                        ) : null}
                                    </div>
                                ) : null}

                                {bundle?.isBundleMaster ? (
                                    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3" id="ticket-bundle-master-panel">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-sm font-semibold text-gray-900">{t('details.bundle.title', 'Bundle')}</div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    id="ticket-bundle-toggle-mode-button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleToggleBundleMode}
                                                    disabled={isUpdatingBundleSettings}
                                                >
                                                    {t('details.bundle.mode', 'Mode: {{mode}}', { mode: (bundle.mode || 'sync_updates').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') })}
                                                </Button>
                                                <Button
                                                    id="ticket-bundle-unbundle-button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleUnbundleMaster}
                                                >
                                                    {t('details.bundle.unbundle', 'Unbundle')}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-500 mb-2">
                                            {t('details.bundle.childrenDescription', 'Children keep their current status when bundled. In Sync Updates mode, closing or reopening the master closes or reopens all children, status, assignee and priority changes on the master apply to them, and their workflow fields are locked. In Link Only mode, children manage their own status, assignee and priority. Internal notes stay on the master.')}
                                        </div>
                                        <div className="flex items-center gap-2 mb-3" ref={searchContainerRef}>
                                            <div className="relative flex-1">
                                                <Input
                                                    id="ticket-bundle-add-child-input"
                                                    ref={searchInputRef}
                                                    value={addChildTicketNumber}
                                                    onChange={handleSearchInputChange}
                                                    onFocus={() => addChildTicketNumber.trim() && setShowSearchResults(true)}
                                                    placeholder={t('details.bundle.searchPlaceholder', 'Search ticket number or title…')}
                                                    className="h-8"
                                                    containerClassName="mb-0"
                                                    autoComplete="off"
                                                />
                                                {isSearching && (
                                                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                                        <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                                                    </div>
                                                )}
                                                {showSearchResults && (
                                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                                        {searchResults.length > 0 ? (
                                                            <ul className="py-1">
                                                                {searchResults.map((result) => (
                                                                    <li
                                                                        key={result.ticket_id}
                                                                        className="px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                                                                        onClick={() => handleSelectSearchResult(result)}
                                                                    >
                                                                        <div className="min-w-0">
                                                                            <span className="text-sm text-blue-600">
                                                                                {result.ticket_number}
                                                                            </span>
                                                                            <div className="text-xs text-gray-500 truncate">
                                                                                {(result.client_name ? `${result.client_name} · ` : '')}{result.title}
                                                                            </div>
                                                                        </div>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        ) : addChildTicketNumber.trim().length > 0 && !isSearching ? (
                                                            <div className="px-3 py-2 text-sm text-gray-500">
                                                                {t('messages.noTickets', 'No tickets found')}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                )}
                                            </div>
                                            <Button
                                                id="ticket-bundle-add-child-button"
                                                size="sm"
                                                onClick={handleAddChildToBundle}
                                                disabled={!addChildTicketNumber.trim() || isLoadingClosedMasterContext}
                                            >
                                                {t('details.bundle.add', 'Add')}
                                            </Button>
                                        </div>
                                        <div className="max-h-56 overflow-y-auto rounded border border-gray-100">
                                            {Array.isArray(bundle.children) && bundle.children.length > 0 ? (
                                                <ul>
                                                    {bundle.children.map((child: any) => (
                                                        <li key={child.ticket_id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0">
                                                            <div className="min-w-0">
                                                                <a className="text-sm text-blue-600 hover:underline" href={`/msp/tickets/${child.ticket_id}`}>
                                                                    {child.ticket_number}
                                                                </a>
                                                                <span
                                                                    className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                                                        child.closed_at || child.is_closed
                                                                            ? 'bg-gray-100 text-gray-600'
                                                                            : 'bg-emerald-100 text-emerald-700'
                                                                    }`}
                                                                >
                                                                    {child.closed_at || child.is_closed
                                                                        ? t('details.bundle.childClosedStatus', 'Closed')
                                                                        : t('details.bundle.childOpenStatus', 'Open')}
                                                                </span>
                                                                <div className="text-xs text-gray-500 truncate">
                                                                    {(child.client_name ? `${child.client_name} · ` : '')}{child.title}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Button
                                                                    id={`ticket-bundle-promote-child-${child.ticket_id}`}
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handlePromoteChildToMaster(child.ticket_id)}
                                                                >
                                                                    {t('details.bundle.promote', 'Promote')}
                                                                </Button>
                                                                <Button
                                                                    id={`ticket-bundle-remove-child-${child.ticket_id}`}
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handleRemoveChildFromBundle(child.ticket_id)}
                                                                >
                                                                    {t('details.bundle.remove', 'Remove')}
                                                                </Button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <div className="px-3 py-2 text-sm text-gray-500">{t('details.bundle.noChildren', 'No children in this bundle.')}</div>
                                            )}
                                        </div>
                                    </div>
                                ) : null}

                                {capabilities.checklist && (autoCloseState || checklistSummary.requiredTotal > 0) && (
                                    <div id={`${id}-close-rules-banner`} className="mb-4 flex flex-wrap items-center gap-2">
                                        {autoCloseState && (
                                            <div
                                                id={`${id}-auto-close-banner`}
                                                className="flex-1 min-w-[260px] rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                                            >
                                                {t('details.autoClose', "Will close automatically on {{date}} unless there's new activity.", {
                                                    date: formatDate(new Date(autoCloseState.scheduled_close_at), { year: 'numeric', month: 'long', day: 'numeric' }),
                                                })}
                                                {autoCloseState.warning_sent_at ? ` ${t('details.autoCloseWarned', 'The customer has been warned.')}` : ''}
                                            </div>
                                        )}
                                        {checklistSummary.requiredTotal > 0 && (
                                            <button
                                                type="button"
                                                id={`${id}-checklist-progress-chip`}
                                                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                                                    checklistSummary.requiredDone === checklistSummary.requiredTotal
                                                        ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-300'
                                                        : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                                                }`}
                                                onClick={() =>
                                                    document
                                                        .getElementById(`${id}-checklist-section`)
                                                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                                }
                                            >
                                                {`${checklistSummary.requiredDone} of ${checklistSummary.requiredTotal} required checklist items done`}
                                            </button>
                                        )}
                                    </div>
                                )}
        </>
    );

    // Secondary ticket actions. Entry shows the menu in the page header; Grid
    // puts it beside the hero's Resolve / All fields cluster.
    const moreActionsMenu = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    id={`${id}-more-actions-button`}
                    variant="outline"
                    size="sm"
                    aria-label={t('actions.moreActions', { defaultValue: 'More actions' })}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    id={`${id}-print-work-tag-button`}
                    onSelect={() => setIsPrintWorkTagOpen(true)}
                >
                    <Printer className="h-4 w-4 mr-2" />
                    {t('actions.printWorkTag', 'Print work tag')}
                </DropdownMenuItem>
                {capabilities.duplicate ? <DropdownMenuItem
                    id={`${id}-duplicate-ticket-button`}
                    onSelect={() => router.push(buildCreateTicketHref({
                        duplicateFromTicketId: ticket.ticket_id,
                        isAlgaDeskMode,
                    }))}
                >
                    <Copy className="h-4 w-4 mr-2" />
                    {t('actions.duplicate', { defaultValue: 'Duplicate' })}
                </DropdownMenuItem> : null}
                {capabilities.createTemplate && templatePermissions.create ? (
                    <DropdownMenuItem
                        id={`${id}-create-template-menu-item`}
                        onSelect={() => router.push(
                            `/msp/tickets/templates/new?fromTicket=${encodeURIComponent(ticket.ticket_id ?? "")}`
                        )}
                    >
                        <LayoutTemplate className="h-4 w-4 mr-2" />
                        {t('actions.createTemplate', { defaultValue: 'Create template from ticket' })}
                    </DropdownMenuItem>
                ) : null}
                {canCreateWorkflowFromTicket ? (
                    <DropdownMenuItem
                        id="create-workflow-from-ticket-menu-item"
                        onSelect={() => setCreateWorkflowOpen(true)}
                    >
                        <Workflow className="mr-2 h-4 w-4" />
                        {t('actions.createWorkflowFromTicket', { defaultValue: 'Create workflow from ticket' })}
                    </DropdownMenuItem>
                ) : null}
                {capabilities.delete ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            id={`${id}-delete-ticket-button`}
                            onSelect={handleDeleteTicket}
                            className="text-red-600 focus:text-red-700"
                        >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t('actions.delete', { defaultValue: 'Delete' })}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const ticketOriginBadge = (
        <TicketOriginBadge
            origin={ticketOrigin}
            labels={ticketOriginLabels}
            size="sm"
            className="flex-shrink-0"
            systemLabel={originExternalLink?.display.label ?? null}
        />
    );

    // Created / Updated stamps. Entry shows them under the header; Grid folds
    // them into the hero's single metadata line.
    const ticketTimestamps = (
        <>
                    {ticket.entered_at && (
                        <p>
                            {t('fields.created', 'Created')} {createdRelativeTime || (() => {
                                const tz = hasHydrated ? getUserTimeZone() : 'UTC';
                                return formatTicketDateTime(ticket.entered_at, locale, tz, dateFormat, showWeekday);
                            })()}
                        </p>
                    )}
                    {ticket.updated_at && (() => {
                        const updatedTime = updatedRelativeTime || (() => {
                            const tz = hasHydrated ? getUserTimeZone() : 'UTC';
                            return formatTicketDateTime(ticket.updated_at, locale, tz, dateFormat, showWeekday);
                        })();
                        const updatedByName = updatedByUser
                            ? `${updatedByUser.first_name ?? ''} ${updatedByUser.last_name ?? ''}`.trim()
                            : '';
                        return (
                            <p data-testid="ticket-updated-at">
                                {updatedByName
                                    ? t('fields.updatedAtBy', {
                                        defaultValue: 'Updated {{time}} by {{name}}',
                                        time: updatedTime,
                                        name: updatedByName,
                                    })
                                    : <>{t('fields.updated', 'Updated')} {updatedTime}</>}
                            </p>
                        );
                    })()}
        </>
    );
    // App-layer slot sections; absent slots render nothing (no placeholder).
    const slotArgsFor = (layout: 'entry' | 'grid') => ({
        ticket: ticket as ITicket,
        layout,
        refresh: () => refreshScreen(),
    });
    const activeLayout = useGridLayout ? 'grid' : 'entry';
    const appSectionNode = dataSource.slots.appSection?.(slotArgsFor(activeLayout)) ?? null;
    const timeSummarySlot = dataSource.slots.timeSummary?.({
        ...slotArgsFor(activeLayout),
        timeEntriesRefreshKey,
    }) ?? null;

    return (
        <ReflectionContainer id={id} label={`Ticket Details - ${ticket.ticket_number}`}>
            <div className="bg-[rgb(var(--color-app-ground))]">
                <div className="sticky top-0 z-10 bg-[rgb(var(--color-app-ground))] py-2 flex items-start gap-2">
                    {!isInDrawer && (
                        <div className="flex-shrink-0 self-start">
                            <BackNav href={ticketsListHref} variant="ghost" size="sm">← {t('navigation.tickets', 'Tickets')}</BackNav>
                        </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-wrap">
                                {!isInDrawer && capabilities.navigation && ticket.ticket_id && (
                                    <TicketNavigation currentTicketId={ticket.ticket_id} initialAdjacent={bootstrap?.streams?.adjacentTickets} />
                                )}
                                {!useGridLayout ? (
                                    <h6 className="text-sm font-medium whitespace-nowrap">#{ticket.ticket_number}</h6>
                                ) : null}
                                {/* Grid shows reply status as a hero field; don't repeat it here. */}
                                {!useGridLayout && responseStateTrackingEnabled && ticket.response_state ? (
                                    <ResponseStateBadge
                                        responseState={ticket.response_state}
                                        size="sm"
                                        showTooltip={false}
                                        className="flex-shrink-0"
                                    />
                                ) : null}
                                {!useGridLayout ? ticketOriginBadge : null}
                                {recurringSource ? (
                                    <Link
                                        id="ticket-recurring-source-link"
                                        href={`/msp/tickets/recurring/${recurringSource.definition_id}`}
                                        className="flex-shrink-0 text-xs text-[rgb(var(--color-primary-600))] hover:underline"
                                    >
                                        {t('recurring.badge.source', 'Recurring: {{name}}', { name: recurringSource.name })}
                                    </Link>
                                ) : null}
                                {ticket.duplicated_from_ticket_id && ticket.duplicated_from_ticket_number ? (
                                    <Link
                                        href={`/msp/tickets/${ticket.duplicated_from_ticket_id}`}
                                        id={`${id}-duplicated-from-link`}
                                        className="flex-shrink-0 text-xs text-[rgb(var(--color-primary-600))] hover:underline whitespace-nowrap"
                                    >
                                        {t('details.duplicatedFrom', {
                                            defaultValue: 'Duplicated from #{{number}}',
                                            number: ticket.duplicated_from_ticket_number,
                                        })}
                                    </Link>
                                ) : null}
                                {ticket.created_from_template_id && ticket.created_from_template_name ? (
                                    templatePermissions.read ? (
                                        <Link
                                            id={`${id}-created-from-template-link`}
                                            href={`/msp/tickets/templates/${ticket.created_from_template_id}`}
                                            className="flex-shrink-0 text-xs text-[rgb(var(--color-primary-600))] hover:underline whitespace-nowrap"
                                        >
                                            {t('details.fromTemplate', {
                                                defaultValue: 'From template: {{name}}',
                                                name: ticket.created_from_template_name,
                                            })}
                                        </Link>
                                    ) : (
                                        <span
                                            id={`${id}-created-from-template`}
                                            className="flex-shrink-0 text-xs text-gray-600 whitespace-nowrap"
                                        >
                                            {t('details.fromTemplate', {
                                                defaultValue: 'From template: {{name}}',
                                                name: ticket.created_from_template_name,
                                            })}
                                        </span>
                                    )
                                ) : null}
                            </div>

                            <div className="flex items-center gap-2">
                                {capabilities.live && ticketLive.enabled && ticketLive.connectionStatus === 'connected' && livePresenceUsers.length > 0 ? (
                                    <PresenceBar users={livePresenceUsers} />
                                ) : null}
                                {capabilities.live && useGridLayout && ticketLive.enabled && connectionStatusLabel ? (
                                    <span
                                        className="inline-flex h-6 w-6 items-center justify-center"
                                        data-testid="ticket-live-connection-status"
                                        title={connectionStatusLabel}
                                        aria-label={connectionStatusLabel}
                                    >
                                        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                                    </span>
                                ) : null}
                                {capabilities.live && !useGridLayout && ticketLive.enabled && connectionStatusLabel ? (
                                    <span
                                        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 whitespace-nowrap"
                                        data-testid="ticket-live-connection-status"
                                        title={connectionStatusLabel}
                                    >
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                                        {t('liveUpdates.connection.offlineShort', 'Offline')}
                                    </span>
                                ) : null}
                                {!isInDrawer ? (
                                    <LayoutToggle value={layoutMode} onChange={handleLayoutModeChange} />
                                ) : null}
                                {/* Add popout button only when in drawer */}
                                {isInDrawer && (
                                    <Button
                                        id="ticket-popout-button"
                                        variant="outline"
                                        size="sm"
                                        onClick={openTicketInNewWindow}
                                        className="flex items-center gap-2"
                                        aria-label={t('fields.openInNewTab', 'Open in new tab')}
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        <span>{t('fields.openInNewTab', 'Open in new tab')}</span>
                                    </Button>
                                )}
                                {!useGridLayout ? moreActionsMenu : null}
                                {renderCreateWorkflowFromTicket && canCreateWorkflowFromTicket
                                    ? renderCreateWorkflowFromTicket({
                                        ticketId: ticket.ticket_id as string,
                                        ticketNumber: ticket.ticket_number ?? '',
                                        title: ticket.title,
                                        open: createWorkflowOpen,
                                        onOpenChange: setCreateWorkflowOpen,
                                    })
                                    : null}
                            </div>
                        </div>
                        <h1
                            className={`text-lg font-bold truncate transition-all duration-200 ${cardTitleVisible ? 'opacity-0 max-h-0 overflow-hidden' : 'opacity-100 max-h-8'}`}
                        >
                            {ticket.title}
                        </h1>
                    </div>
                </div>

                {!useGridLayout ? (
                    <div className="flex items-center space-x-5 mb-5 text-sm text-gray-600">
                        {ticketTimestamps}
                    </div>
                ) : null}
                {/* Delete Ticket Dialog (with dependency validation) */}
                {capabilities.delete ? (
                <DeleteEntityDialog
                    id={`${id}-delete-ticket-dialog`}
                    isOpen={isDeleteTicketDialogOpen}
                    onClose={resetTicketDeleteState}
                    onConfirmDelete={confirmTicketDelete}
                    entityName={`#${ticket.ticket_number}`}
                    validationResult={ticketDeleteValidation}
                    isValidating={isTicketDeleteValidating}
                    isDeleting={isTicketDeleteProcessing}
                />
                ) : null}

                {/* Confirmation Dialog for Comment Deletion */}
                <ConfirmationDialog
                    id={`${id}-delete-comment-dialog`}
                    isOpen={isDeleteDialogOpen}
                    onClose={resetCommentDeleteState}
                    onConfirm={() => handleDeleteConfirm(true)}
                    onCancel={deleteDialogHasImages ? () => handleDeleteConfirm(false) : undefined}
                    title={t('conversation.deleteComment', 'Delete Comment')}
                    message={deleteDialogMessage}
                    confirmLabel={deleteDialogHasImages ? t('conversation.deleteCommentImages', 'Delete Comment + Images') : t('conversation.delete', 'Delete')}
                    thirdButtonLabel={deleteDialogHasImages ? t('conversation.deleteCommentOnly', 'Delete Comment Only') : undefined}
                    cancelLabel={t('actions.cancel', 'Cancel')}
                    isConfirming={isDeletingComment}
                />

                <TicketResolutionDialog
                    id={`${id}-resolution-close`}
                    isOpen={isResolutionCloseDialogOpen}
                    ticketId={ticket.ticket_id!}
                    currentUserId={userId}
                    statusOptions={closedStatusOptions}
                    isSubmitting={isSubmittingResolutionClose}
                    clientId={ticket.client_id ?? null}
                    allowEmailRecipients
                    onClose={() => {
                        if (!isSubmittingResolutionClose) {
                            setIsResolutionCloseDialogOpen(false);
                        }
                    }}
                    onConfirm={handleResolveAndClose}
                    onClipboardImageUploaded={refreshTicketDocuments}
                    uploadTicketAttachmentAction={uploadTicketAttachmentAction}
                    deleteDraftTicketAttachmentImagesAction={deleteDraftTicketAttachmentImagesAction}
                    resolveTicketAttachmentViewUrl={resolveTicketAttachmentViewUrl}
                />

                {/* An edit just flagged a comment as the resolution: offer the
                    close that the composer's resolution toggle does inline. */}
                <Dialog
                    id={`${id}-resolution-close-prompt`}
                    isOpen={resolutionClosePrompt.isOpen}
                    onClose={() => {
                        if (!isSubmittingResolutionClosePrompt) {
                            closeResolutionClosePrompt();
                        }
                    }}
                    title={t('info.closeTicketNowTitle', 'Close the ticket now?')}
                >
                    <DialogContent>
                        <p className="mb-4 text-sm text-[rgb(var(--color-text-600))]">
                            {t(
                                'info.closeTicketNowPrompt',
                                'This comment is now the resolution. Pick a close status to close the ticket, or leave it open.',
                            )}
                        </p>
                        <CustomSelect
                            id={`${id}-resolution-close-prompt-status`}
                            label={t('conversation.closeStatus', 'Close status')}
                            value={resolutionClosePrompt.statusId}
                            options={closedStatusOptions}
                            onValueChange={(value: string) =>
                                setResolutionClosePrompt((prev) => ({ ...prev, statusId: value }))
                            }
                            placeholder={t('info.selectCloseStatus', 'Select a close status')}
                            disabled={isSubmittingResolutionClosePrompt}
                        />
                        <div className="mt-4">
                            <TicketNotificationSuppressionControl
                                idPrefix={`${id}-resolution-close-prompt-notification-suppression`}
                                value={resolutionClosePrompt.suppression}
                                onChange={(suppression) =>
                                    setResolutionClosePrompt((prev) => ({ ...prev, suppression }))
                                }
                                disabled={isSubmittingResolutionClosePrompt}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                id={`${id}-resolution-close-prompt-decline`}
                                type="button"
                                variant="outline"
                                onClick={closeResolutionClosePrompt}
                                disabled={isSubmittingResolutionClosePrompt}
                            >
                                {t('info.leaveTicketOpen', 'Leave open')}
                            </Button>
                            <Button
                                id={`${id}-resolution-close-prompt-confirm`}
                                type="button"
                                onClick={confirmResolutionClosePrompt}
                                disabled={!resolutionClosePrompt.statusId || isSubmittingResolutionClosePrompt}
                            >
                                {isSubmittingResolutionClosePrompt
                                    ? t('info.closing', 'Closing…')
                                    : t('info.closeTicketTitle', 'Close ticket')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog
                    id={`${id}-contact-change-prompt`}
                    isOpen={contactChangePrompt.isOpen}
                    onClose={() => {
                        if (!isSubmittingContactChange) {
                            closeContactChangePrompt();
                        }
                    }}
                    title={
                        contactChangePrompt.contactId
                            ? t('info.changeContactTitle', 'Change the ticket contact?')
                            : t('info.removeContactTitle', 'Remove the ticket contact?')
                    }
                >
                    <DialogContent>
                        <p className="mb-4 text-sm text-[rgb(var(--color-text-600))]">
                            {t(
                                'info.changeContactPrompt',
                                'The contact, assignee and watchers are told about this update unless you turn their notifications off.',
                            )}
                        </p>
                        <TicketNotificationSuppressionControl
                            idPrefix={`${id}-contact-change-prompt-notification-suppression`}
                            value={contactChangePrompt.suppression}
                            onChange={(suppression) =>
                                setContactChangePrompt((prev) => ({ ...prev, suppression }))
                            }
                            disabled={isSubmittingContactChange}
                        />
                        <DialogFooter>
                            <Button
                                id={`${id}-contact-change-prompt-cancel`}
                                type="button"
                                variant="outline"
                                onClick={closeContactChangePrompt}
                                disabled={isSubmittingContactChange}
                            >
                                {t('actions.cancel', 'Cancel')}
                            </Button>
                            <Button
                                id={`${id}-contact-change-prompt-confirm`}
                                type="button"
                                onClick={() => void confirmContactChangePrompt()}
                                disabled={isSubmittingContactChange}
                            >
                                {isSubmittingContactChange
                                    ? t('info.saving', 'Saving…')
                                    : contactChangePrompt.contactId
                                        ? t('info.changeContact', 'Change contact')
                                        : t('info.removeContact', 'Remove contact')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Sync-mode bundle master: choose whether a boundary-crossing
                    status change propagates to the affected children. */}
                {capabilities.bundles ? (
                <BundleStatusPropagationDialog
                    isOpen={bundlePropagationPreview !== null}
                    preview={bundlePropagationPreview}
                    isSubmitting={isSubmittingBundlePropagation}
                    onCancel={() => resolveBundlePropagationDecision({ proceed: false })}
                    onMasterOnly={() => resolveBundlePropagationDecision({ proceed: true, propagateToChildren: false })}
                    onPropagate={() => resolveBundlePropagationDecision({ proceed: true, propagateToChildren: true })}
                />
                ) : null}

                {/* Blocked-close dialog: unmet close rules with quick actions and
                    a permissioned "Close anyway" override. */}
                <Dialog
                    id={`${id}-close-blocked-dialog`}
                    isOpen={closeBlockedDialog.isOpen}
                    onClose={() => {
                        setCloseBlockedDialog({ isOpen: false, statusId: null, failures: [], canOverride: false, suppression: null });
                        setCloseOverrideReason('');
                    }}
                    title={t('info.cannotCloseYet', "This ticket can't be closed yet")}
                >
                    <DialogContent>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                            {t('info.closeRulesIntro', "The board's close rules require the following before this ticket can be closed:")}
                        </p>
                        <ul className="space-y-2 mb-4">
                            {closeBlockedDialog.failures.map((failure) => (
                                <li
                                    key={failure.rule}
                                    className="flex items-center justify-between gap-2 rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
                                >
                                    <span>{failure.message}</span>
                                    {failure.rule === 'checklist_incomplete' && (
                                        <Button
                                            id={`${id}-close-blocked-view-checklist`}
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setCloseBlockedDialog({ isOpen: false, statusId: null, failures: [], canOverride: false, suppression: null });
                                                document
                                                    .getElementById(`${id}-checklist-section`)
                                                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }}
                                        >
                                            {t('info.viewChecklist', 'View checklist')}
                                        </Button>
                                    )}
                                    {failure.rule === 'resolution_comment' && (
                                        <Button
                                            id={`${id}-close-blocked-add-comment`}
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setCloseBlockedDialog({ isOpen: false, statusId: null, failures: [], canOverride: false, suppression: null });
                                                document
                                                    .getElementById(`${id}-conversation`)
                                                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }}
                                        >
                                            {t('info.addComment', 'Add comment')}
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        {closeBlockedDialog.canOverride && (
                            <div className="mb-2">
                                <TextArea
                                    id={`${id}-close-override-reason`}
                                    value={closeOverrideReason}
                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCloseOverrideReason(e.target.value)}
                                    placeholder={t('info.closeReasonPlaceholder', 'Reason for closing anyway (optional, recorded in the audit log)')}
                                    rows={2}
                                />
                            </div>
                        )}
                        <DialogFooter>
                            <Button
                                id={`${id}-close-blocked-cancel`}
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setCloseBlockedDialog({ isOpen: false, statusId: null, failures: [], canOverride: false, suppression: null });
                                    setCloseOverrideReason('');
                                }}
                            >
                                {t('actions.cancel', 'Cancel')}
                            </Button>
                            {closeBlockedDialog.canOverride && (
                                <Button
                                    id={`${id}-close-blocked-close-anyway`}
                                    type="button"
                                    variant="destructive"
                                    onClick={submitCloseOverride}
                                    disabled={isSubmittingCloseOverride}
                                >
                                    {isSubmittingCloseOverride ? t('info.closing', 'Closing…') : t('info.closeAnyway', 'Close anyway')}
                                </Button>
                            )}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <ConfirmationDialog
                    id={`${id}-bundle-add-child-multi-client-confirm`}
                    isOpen={isAddChildMultiClientConfirmOpen}
                    onClose={() => {
                        setIsAddChildMultiClientConfirmOpen(false);
                        setPendingChildToAdd(null);
                    }}
                    onConfirm={async () => {
                        if (!pendingChildToAdd?.ticket_id) {
                            setIsAddChildMultiClientConfirmOpen(false);
                            return;
                        }
                        try {
                            await beginAddChildToBundle(pendingChildToAdd.ticket_id);
                        } catch (error) {
                            handleTicketActionError(error, t('messages.addToBundleFailed'));
                        } finally {
                            setIsAddChildMultiClientConfirmOpen(false);
                            setPendingChildToAdd(null);
                        }
                    }}
                    title={t('bulk.bundle.multiClientTitle', 'Bundle spans multiple clients')}
                    message={t('details.bundle.addChildMultiClientMessage', 'This will add {{ticket}} from a different client into the bundle. Confirm you want to proceed.', { ticket: pendingChildToAdd?.ticket_number || t('details.bundle.thisTicket', 'this ticket') })}
                    confirmLabel={t('actions.proceed', 'Proceed')}
                    cancelLabel={t('actions.cancel', 'Cancel')}
                />

                <Dialog
                    id={`${id}-bundle-closed-master-choice-dialog`}
                    isOpen={isClosedMasterChoiceOpen}
                    onClose={() => {
                        setIsClosedMasterChoiceOpen(false);
                        setPendingClosedMasterChildId(null);
                        setIsModeSwitchPending(false);
                    }}
                    className="max-w-lg"
                >
                    <DialogContent>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            {t('details.bundle.closedMasterDialogTitle', "This bundle's master is closed")}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {isModeSwitchPending
                                ? t('details.bundle.modeSwitchDialogIntro', 'The master is closed. Choose what should happen to the open children when the bundle switches to Sync Updates.')
                                : t('details.bundle.closedMasterDialogIntro', 'The master is closed. Choose what should happen to the child when it is added.')}
                        </p>
                        {closedMasterContext && (
                            <div className="mt-4">
                                <ClosedMasterChoiceFields
                                    idPrefix={`${id}-bundle-closed-master`}
                                    allowedChoices={closedMasterContext.allowedChoices}
                                    value={closedMasterChoice}
                                    onChange={setClosedMasterChoice}
                                    hasResolutionComment={closedMasterContext.hasResolutionComment}
                                    masterStatusName={closedMasterContext.masterStatusName}
                                    variant={isModeSwitchPending ? 'switch' : 'add'}
                                />
                            </div>
                        )}
                        <DialogFooter>
                            <Button
                                id={`${id}-bundle-closed-master-cancel`}
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setIsClosedMasterChoiceOpen(false);
                                    setPendingClosedMasterChildId(null);
                                    setIsModeSwitchPending(false);
                                }}
                            >
                                {t('actions.cancel', 'Cancel')}
                            </Button>
                            <Button
                                id={`${id}-bundle-closed-master-confirm`}
                                type="button"
                                disabled={!closedMasterChoice || (!pendingClosedMasterChildId && !isModeSwitchPending)}
                                onClick={async () => {
                                    if (isModeSwitchPending && closedMasterChoice) {
                                        const choice = closedMasterChoice;
                                        setIsClosedMasterChoiceOpen(false);
                                        setIsModeSwitchPending(false);
                                        await performBundleModeChange('sync_updates', choice);
                                        return;
                                    }
                                    if (!pendingClosedMasterChildId || !closedMasterChoice) return;
                                    const childId = pendingClosedMasterChildId;
                                    const choice = closedMasterChoice;
                                    setIsClosedMasterChoiceOpen(false);
                                    setPendingClosedMasterChildId(null);
                                    await performAddChildToBundle(childId, choice);
                                }}
                            >
                                {isModeSwitchPending
                                    ? t('details.bundle.modeSwitchConfirm', 'Switch to Sync Updates')
                                    : t('details.bundle.add', 'Add')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <ConfirmationDialog
                    id={`${id}-time-period-dialog`}
                    isOpen={isTimeEntryPeriodDialogOpen}
                    onClose={() => setIsTimeEntryPeriodDialogOpen(false)}
                    onConfirm={() => {
                        setIsTimeEntryPeriodDialogOpen(false);
                        router.push('/msp/settings?tab=time-entry&subtab=time-periods');
                    }}
                    title={t('info.noActiveTimePeriodTitle', 'No Active Time Period')}
                    message={t('info.noActiveTimePeriodMessage', 'No active time period found. Time periods need to be set up in the billing dashboard before adding time entries.')}
                    confirmLabel={t('info.goToTimePeriodsSetup', 'Go to Time Periods Setup')}
                    cancelLabel={t('actions.cancel', 'Cancel')}
                />

                <ConfirmationDialog
                    id={`${id}-delete-time-entry-dialog`}
                    isOpen={pendingDeleteTimeEntry !== null}
                    onClose={() => {
                        if (!isDeletingTimeEntry) setPendingDeleteTimeEntry(null);
                    }}
                    onConfirm={handleConfirmDeleteTimeEntry}
                    title={t('timeEntries.deleteConfirmTitle', { defaultValue: 'Delete time entry?' })}
                    message={t('timeEntries.deleteConfirmMessage', {
                        defaultValue: 'This will permanently delete the time entry. This action cannot be undone.',
                    })}
                    confirmLabel={t('timeEntries.deleteConfirmAction', { defaultValue: 'Delete' })}
                    cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
                    isConfirming={isDeletingTimeEntry}
                />

                {bundleAndCloseBanners}
                {useGridLayout ? (
                <TicketBentoLayout
                    heroMeta={
                        <>
                            {ticketOriginBadge}
                            {/* Relative stamps; the absolute time is the tooltip. */}
                            {ticket.entered_at && hasHydrated ? (
                                <p title={formatTicketDateTime(ticket.entered_at, locale, getUserTimeZone(), dateFormat, showWeekday)}>
                                    {t('fields.created', 'Created')} {formatTicketRelativeToNow(ticket.entered_at, locale)}
                                </p>
                            ) : null}
                            {ticket.updated_at && hasHydrated ? (
                                <p data-testid="ticket-updated-at" title={formatTicketDateTime(ticket.updated_at, locale, getUserTimeZone(), dateFormat, showWeekday)}>
                                    {(() => {
                                        const time = formatTicketRelativeToNow(ticket.updated_at, locale);
                                        const name = updatedByUser
                                            ? `${updatedByUser.first_name ?? ''} ${updatedByUser.last_name ?? ''}`.trim()
                                            : '';
                                        return name
                                            ? t('fields.updatedAtBy', { defaultValue: 'Updated {{time}} by {{name}}', time, name })
                                            : `${t('fields.updated', 'Updated')} ${time}`;
                                    })()}
                                </p>
                            ) : null}
                        </>
                    }
                    heroMoreActions={moreActionsMenu}
                    id={`${id}-bento`}
                    titleRef={cardTitleRef}
                    ticket={ticket as any}
                    statusOptions={statusOptions}
                    priorityOptions={priorityOptions}
                    boardOptions={boardOptions}
                    agentOptions={agentOptions}
                    onSelectChange={handleSelectChange}
                    onBatchSelectChange={(changes, options) => handleBatchSaveChanges(changes, options)}
                    onUpdateDescription={handleUpdateDescription}
                    responseStateTrackingEnabled={responseStateTrackingEnabled}
                    defaultReplyInternal={defaultReplyInternal}
                    hideSlaStatus={effectiveHideSlaStatus}
                    hideBilling={effectiveHideBilling}
                    hideScheduling={effectiveHideScheduling}
                    workflowLocked={bundleWorkflowLocked}
                    onOpenAllFields={() => setIsAllFieldsDrawerOpen(true)}
                    tags={tags}
                    onTagsChange={capabilities.tags ? handleTagsChange : undefined}
                    taskActions={effectiveRenderCreateProjectTask?.({ ticket, additionalAgents: additionalAgentsForInfo })}
                    quickInvoiceActions={effectiveRenderQuickInvoice?.({ ticket })}
                    receiveEquipmentActions={renderReceiveEquipment?.({ ticket })}
                    onResolveAndClose={ticket.ticket_id && !currentStatusIsClosed
                        ? () => setIsResolutionCloseDialogOpen(true)
                        : undefined}
                    resolveAndCloseDisabled={closedStatusOptions.length === 0 || isSubmitting || isSubmittingResolutionClose}
                    liveHighlightedFields={liveHighlightedFields}
                    liveFrozenFields={frozenFieldList}
                    liveFieldConflicts={liveFieldConflicts}
                    onLiveDirtyFieldsChange={setTicketInfoDirtyFields}
                    onKeepLiveConflict={handleKeepLiveConflict}
                    onTakeLiveConflict={handleTakeLiveConflict}
                    liveEditingUsers={liveEditingUsers}
                    onLiveEditingFieldChange={ticketLive.setEditingField}
                    onAgentClick={handleAgentClick}
                    locations={locations}
                    conversations={conversations}
                    userMap={userMap}
                    contactMap={contactMap}
                    timelineRefreshKey={`${conversations.length}-${activityLogRefreshKey}-${timeEntriesRefreshKey}`}
                    timelineInitialOrder={timelinePrefOrder}
                    editorKey={editorKey}
                    isSubmitting={isSubmitting}
                    onNewCommentContentChange={setNewCommentContent}
                    onAddNewComment={handleAddNewComment}
                    closedStatusOptions={closedStatusOptions}
                    onAddReplyComment={handleAddReplyComment}
                    bentoStreams={bootstrap?.streams ?? undefined}
                    currentUser={currentUser ? {
                        id: currentUser.user_id,
                        name: `${currentUser.first_name} ${currentUser.last_name}`,
                        email: currentUser.email,
                    } : (session?.user?.id ? {
                        id: session.user.id,
                        name: session.user.name ?? '',
                        email: session.user.email ?? undefined,
                    } : null)}
                    isEditing={isEditing}
                    currentComment={currentComment}
                    onContentChange={handleContentChange}
                    onSaveComment={handleSave}
                    onCloseEdit={handleClose}
                    onEditComment={handleEdit}
                    onDeleteComment={handleDeleteRequest}
                    reactionRefreshVersion={reactionRefreshVersion}
                    canViewCommentMetadataDebug={canViewCommentMetadataDebug}
                    onClipboardImageUploaded={refreshTicketDocuments}
                    uploadTicketAttachmentAction={uploadTicketAttachmentAction}
                    deleteDraftTicketAttachmentImagesAction={deleteDraftTicketAttachmentImagesAction}
                    resolveTicketAttachmentViewUrl={resolveTicketAttachmentViewUrl}
                    createdByUser={createdByUser}
                    contactInfo={contactInfo}
                    displayTags={displayTags}
                    client={client}
                    onContactClick={handleContactClick}
                    onClientClick={handleClientClick}
                    clients={clients}
                    onChangeContact={handleContactChange}
                    onChangeClient={handleClientChange}
                    onChangeLocation={handleLocationChange}
                    onChangeBillingProfile={handleBillingProfileChange}
                    checklistItems={checklistItems ?? []}
                    onChecklistItemsChanged={setChecklistItems}
                    externalLinks={externalLinks ?? undefined}
                    onExternalLinksChanged={setExternalLinks}
                    hideTimeEntry={effectiveHideTimeEntry}
                    timeSummarySlot={timeSummarySlot}
                    appSection={appSectionNode}
                    isLiveTicketTimerEnabled={isLiveTicketTimerEnabled}
                    timeDescription={timeDescription}
                    onTimeDescriptionChange={setTimeDescription}
                    onTimeEntryLogged={handleStopwatchEntryLogged}
                    onAddTimeEntry={handleAddTimeEntry}
                    isLaunchingTimeEntry={isLaunchingTimeEntry}
                    onScheduleWork={handleScheduleWork}
                    onOpenScheduleEntry={handleOpenScheduleEntry}
                    scheduleRefreshKey={scheduleRefreshKey}
                    userId={userId || ''}
                    showWeekday={showWeekday}
                    timeEntriesRefreshKey={timeEntriesRefreshKey}
                    onEditTimeEntry={handleEditTimeEntry}
                    onDeleteTimeEntry={handleRequestDeleteTimeEntry}
                    additionalAgents={additionalAgents}
                    availableAgents={availableAgents}
                    onAddAgent={handleAddAgent}
                    onRemoveAgent={handleRemoveAgent}
                    teams={teams}
                    team={team}
                    onAssignTeam={handleAssignTeam}
                    onRemoveTeamAssignment={handleRemoveTeamAssignment}
                    onAddWatchers={handleAddWatchers}
                    onSetWatcherActive={handleSetWatcherActive}
                    onRemoveWatcher={handleRemoveWatcher}
                    watchListSaving={isWatchListSaving}
                    contacts={contacts}
                    allContactsForWatchList={allContactsForWatchList}
                    allContactsForWatchListLoading={allContactsForWatchListLoading}
                    onLoadAllContactsForWatchList={handleLoadAllContactsForWatchList}
                    hideMaterials={effectiveHideMaterials}
                    surveySummaryCard={effectiveSurveySummaryCard}
                    associatedAssets={effectiveAssociatedAssets}
                    documents={documents}
                    onDocumentCreated={async () => {
                        refreshScreen();
                    }}
                    disableAttachmentFolderSelection={disableAttachmentFolderSelection}
                    disableAttachmentSharing={disableAttachmentSharing}
                    disableAttachmentLinking={disableAttachmentLinking}
                />
                ) : (
                <div className="flex gap-6 min-w-0">
                    <div className="flex-grow col-span-2 min-w-0" id="ticket-main-content">
                        <Suspense fallback={<div id="ticket-info-skeleton" className="animate-pulse skeleton-fill h-64 rounded-lg mb-6"></div>}>
                            <div className="mb-6">
                                <TicketInfo
                                    id={`${id}-info`}
                                    titleRef={cardTitleRef}
                                    ticket={ticket}
                                    conversations={conversations}
                                    statusOptions={statusOptions}
                                    agentOptions={agentOptions}
                                    boardOptions={boardOptions}
                                    priorityOptions={priorityOptions}
                                    onSelectChange={handleSelectChange}
                                    onSaveChanges={handleBatchSaveChanges}
                                    onUpdateDescription={handleUpdateDescription}
                                    isSubmitting={isSubmitting}
                                    users={availableAgents}
                                    tags={tags}
                                    allTagTexts={allTags.filter(tag => tag.tagged_type === 'ticket').map(tag => tag.tag_text)}
                                    onTagsChange={capabilities.tags ? handleTagsChange : undefined}
                                    isInDrawer={isInDrawer}
                                    onItilFieldChange={handleItilFieldChange}
                                    initialCategories={initialCategories}
                                    itilImpact={itilImpact}
                                    itilUrgency={itilUrgency}
                                    isBundledChild={bundleWorkflowLocked}
                                    responseStateTrackingEnabled={responseStateTrackingEnabled}
                                    renderProjectTaskActions={effectiveRenderCreateProjectTask}
                                    renderQuickInvoiceActions={effectiveRenderQuickInvoice}
                                    renderReceiveEquipmentActions={renderReceiveEquipment}
                                    onResolveAndClose={ticket.ticket_id && !currentStatusIsClosed
                                        ? () => setIsResolutionCloseDialogOpen(true)
                                        : undefined}
                                    resolveAndCloseDisabled={closedStatusOptions.length === 0 || isSubmitting || isSubmittingResolutionClose}
                                    teams={teams}
                                    onAssignTeam={handleAssignTeam}
                                    onRemoveTeamAssignment={async () => {
                                        await handleRemoveTeamAssignment('remove_all');
                                    }}
                                    onClipboardImageUploaded={refreshTicketDocuments}
                                    uploadTicketAttachmentAction={uploadTicketAttachmentAction}
                                    deleteDraftTicketAttachmentImagesAction={deleteDraftTicketAttachmentImagesAction}
                                    resolveTicketAttachmentViewUrl={resolveTicketAttachmentViewUrl}
                                    onOpenEmailNotificationLogs={() => setIsEmailNotificationLogsDrawerOpen(true)}
                                    onOpenActivityLog={capabilities.activityLog ? () => {
                                        setActivityLogRefreshKey((value) => value + 1);
                                        setIsActivityLogDrawerOpen(true);
                                    } : undefined}
                                    hideSlaStatus={effectiveHideSlaStatus}
                                    additionalAgents={additionalAgentsForInfo}
                                    onLiveDirtyFieldsChange={setTicketInfoDirtyFields}
                                    liveHighlightedFields={liveHighlightedFields}
                                    liveFieldConflicts={liveFieldConflicts}
                                    liveFrozenFields={frozenFieldList}
                                    onKeepLiveConflict={handleKeepLiveConflict}
                                    onTakeLiveConflict={handleTakeLiveConflict}
                                    liveEditingUsers={liveEditingUsers}
                                    onLiveEditingFieldChange={ticketLive.setEditingField}
                                />
                            </div>
                        </Suspense>
                        <Suspense fallback={<div id="ticket-conversation-skeleton" className="animate-pulse skeleton-fill h-96 rounded-lg mb-6"></div>}>
                            <div className="mb-6">
                                <TicketConversation
                                    id={`${id}-conversation`}
                                    ticket={ticket}
                                    conversations={conversations}
                                    documents={documents}
                                    userMap={userMap}
                                    contactMap={contactMap}
                                    currentUser={currentUser ? {
                                        id: currentUser.user_id,
                                        name: `${currentUser.first_name} ${currentUser.last_name}`,
                                        email: currentUser.email,
                                        avatarUrl: null
                                    } : session?.user}
                                    activeTab={activeTab}
                                    closedStatusOptions={closedStatusOptions}
                                    isEditing={isEditing}
                                    currentComment={currentComment}
                                    editorKey={editorKey}
                                    onNewCommentContentChange={setNewCommentContent}
                                    onAddNewComment={handleAddNewComment}
                                    onAddReplyComment={handleAddReplyComment}
                                    onTabChange={setActiveTab}
                                    onEdit={handleEdit}
                                    onSave={handleSave}
                                    onClose={handleClose}
                                    onDelete={handleDeleteRequest}
                                    onContentChange={handleContentChange}
                                    isSubmitting={isSubmitting}
                                    hideInternalTab={false}
                                    defaultReplyInternal={defaultReplyInternal}
                                    readOnly={dataSource.screen.readOnly}
                                    externalComments={bundle?.isBundleMaster ? aggregatedChildClientComments : []}
                                    onClipboardImageUploaded={refreshTicketDocuments}
                                    uploadTicketAttachmentAction={uploadTicketAttachmentAction}
                                    deleteDraftTicketAttachmentImagesAction={deleteDraftTicketAttachmentImagesAction}
                                    resolveTicketAttachmentViewUrl={resolveTicketAttachmentViewUrl}
                                    defaultNewestFirst
                                    canViewCommentMetadataDebug={canViewCommentMetadataDebug}
                                    reactionRefreshVersion={reactionRefreshVersion}
                                    externalLinksByCommentId={externalLinksByCommentId}
                                    allowEmailRecipients
                                />
                            </div>
                        </Suspense>
                        
                        {capabilities.checklist ? (
                        <div className="mb-6">
                            <TicketChecklistSection
                                id={`${id}-checklist-section`}
                                ticketId={ticket.ticket_id || ''}
                                initialItems={checklistItems}
                                onItemsChanged={setChecklistItems}
                            />
                        </div>
                        ) : null}

                        {capabilities.documents ? (
                        <Suspense fallback={<div id="ticket-documents-skeleton" className="animate-pulse skeleton-fill h-64 rounded-lg mb-6"></div>}>
                            <TicketDocumentsSection
                                id={`${id}-documents-section`}
                                ticketId={ticket.ticket_id || ''}
                                initialDocuments={documents}
                                forceUploadToRoot={disableAttachmentFolderSelection}
                                allowDocumentSharing={!disableAttachmentSharing}
                                allowLinkExistingDocuments={!disableAttachmentLinking}
                                allowBlockDocuments={!disableAttachmentLinking}
                                onDocumentCreated={async () => {
                                    refreshScreen();
                                }}
                            />
                        </Suspense>
                        ) : null}

                        {capabilities.credentials ? (
                        <TicketCredentialsSection
                            ticketId={ticket.ticket_id || ''}
                            clientId={ticket.client_id ?? null}
                            readOnly={dataSource.screen.readOnly === true}
                        />
                        ) : null}

                        {capabilities.externalLinks ? (
                        <div className="mt-6">
                            <TicketExternalLinksSection
                                id={`${id}-external-links-section`}
                                ticketId={ticket.ticket_id || ''}
                                initialLinks={externalLinks ?? undefined}
                                onLinksChanged={setExternalLinks}
                            />
                        </div>
                        ) : null}

                    </div>
                    <div className={isInDrawer ? "w-96 shrink-0" : "w-1/4 min-w-[min(100%,18rem)] shrink-0"} id="ticket-properties-container">
                        <Suspense fallback={<div id="ticket-properties-skeleton" className="animate-pulse skeleton-fill h-96 rounded-lg mb-6"></div>}>
                                <TicketProperties
                                    id={`${id}-properties`}
                                    ticket={ticket}
                                client={client}
                                contactInfo={contactInfo}
                                displayTags={displayTags}
                                createdByUser={createdByUser}
                                board={board}
                                timeDescription={timeDescription}
                                onTimeDescriptionChange={setTimeDescription}
                                onTimeEntryLogged={handleStopwatchEntryLogged}
                                onAddTimeEntry={handleAddTimeEntry}
                                isLaunchingTimeEntry={isLaunchingTimeEntry}
                                onClientClick={handleClientClick}
                                onContactClick={handleContactClick}
                                team={team}
                                teams={teams}
                                additionalAgents={additionalAgents}
                                availableAgents={availableAgents}
                                onAgentClick={handleAgentClick}
                                disableAgentSchedule={disableAgentSchedule}
                                onAddAgent={handleAddAgent}
                                onRemoveAgent={handleRemoveAgent}
                                currentTimeSheet={currentTimeSheet}
                                currentTimePeriod={currentTimePeriod}
                                userId={userId || ''}
                                tenant={tenant}
                                contacts={contacts}
                                clients={clients}
                                locations={locations}
                                clientFilterState={clientFilterState}
                                clientTypeFilter={clientTypeFilter}
                                onChangeContact={handleContactChange}
                                onChangeClient={handleClientChange}
                                onChangeLocation={handleLocationChange}
                                onChangeBillingProfile={handleBillingProfileChange}
                                onClientFilterStateChange={setClientFilterState}
                                onClientTypeFilterChange={setClientTypeFilter}
                                tags={tags}
                                allTagTexts={allTags.filter(tag => tag.tagged_type === 'ticket').map(tag => tag.tag_text)}
                                onTagsChange={capabilities.tags ? handleTagsChange : undefined}
                                onItilFieldChange={handleItilFieldChange}
                                onAddWatchers={handleAddWatchers}
                    onSetWatcherActive={handleSetWatcherActive}
                    onRemoveWatcher={handleRemoveWatcher}
                                watchListSaving={isWatchListSaving}
                                allContactsForWatchList={allContactsForWatchList}
                                allContactsForWatchListLoading={allContactsForWatchListLoading}
                                onLoadAllContactsForWatchList={handleLoadAllContactsForWatchList}
                                surveySummaryCard={effectiveSurveySummaryCard}
                                    hideTimeEntry={effectiveHideTimeEntry}
                                    timeSummarySlot={timeSummarySlot}
                                    hideMaterials={effectiveHideMaterials}
                                                    onRemoveTeamAssignment={handleRemoveTeamAssignment}
                                    onAssignTeam={handleAssignTeam}
                                    isLiveTicketTimerEnabled={isLiveTicketTimerEnabled}
                                    timeEntriesRefreshKey={timeEntriesRefreshKey}
                                    onEditTimeEntry={handleEditTimeEntry}
                                    onDeleteTimeEntry={handleRequestDeleteTimeEntry}
                                    onLiveDirtyFieldsChange={setTicketPropertiesDirtyFields}
                                    liveHighlightedFields={liveHighlightedFields}
                                    liveFieldConflicts={liveFieldConflicts}
                                    liveFrozenFields={frozenFieldList}
                                    onKeepLiveConflict={handleKeepLiveConflict}
                                    onTakeLiveConflict={handleTakeLiveConflict}
                                    liveEditingUsers={liveEditingUsers}
                                    onLiveEditingFieldChange={ticketLive.setEditingField}
                                />
                        </Suspense>
                        
                        {appSectionNode ? (
                            <div className="mt-6" id="app-section-container">{appSectionNode}</div>
                        ) : null}

                        {effectiveAssociatedAssets ? <div className="mt-6" id="associated-assets-container">{effectiveAssociatedAssets}</div> : null}
                    </div>
                </div>
                )}
            </div>
            <Drawer
                id={`${id}-all-fields-drawer`}
                isOpen={isAllFieldsDrawerOpen}
                onClose={() => setIsAllFieldsDrawerOpen(false)}
                width="52rem"
            >
                <div className="pr-8">
                    {isAllFieldsDrawerOpen ? (
                        <TicketInfo
                            id={`${id}-all-fields-info`}
                            ticket={ticket}
                            conversations={conversations}
                            statusOptions={statusOptions}
                            agentOptions={agentOptions}
                            boardOptions={boardOptions}
                            priorityOptions={priorityOptions}
                            onSelectChange={handleSelectChange}
                            onSaveChanges={handleBatchSaveChanges}
                            onUpdateDescription={handleUpdateDescription}
                            isSubmitting={isSubmitting}
                            users={availableAgents}
                            tags={tags}
                            allTagTexts={allTags.filter(tag => tag.tagged_type === 'ticket').map(tag => tag.tag_text)}
                            onTagsChange={capabilities.tags ? handleTagsChange : undefined}
                            isInDrawer
                            onItilFieldChange={handleItilFieldChange}
                            initialCategories={initialCategories}
                            itilImpact={itilImpact}
                            itilUrgency={itilUrgency}
                            isBundledChild={bundleWorkflowLocked}
                            responseStateTrackingEnabled={responseStateTrackingEnabled}
                            renderProjectTaskActions={effectiveRenderCreateProjectTask}
                            renderQuickInvoiceActions={effectiveRenderQuickInvoice}
                                    renderReceiveEquipmentActions={renderReceiveEquipment}
                            onResolveAndClose={ticket.ticket_id && !currentStatusIsClosed
                                ? () => setIsResolutionCloseDialogOpen(true)
                                : undefined}
                            resolveAndCloseDisabled={closedStatusOptions.length === 0 || isSubmitting || isSubmittingResolutionClose}
                            teams={teams}
                            onAssignTeam={handleAssignTeam}
                            onRemoveTeamAssignment={async () => {
                                await handleRemoveTeamAssignment('remove_all');
                            }}
                            onClipboardImageUploaded={refreshTicketDocuments}
                            uploadTicketAttachmentAction={uploadTicketAttachmentAction}
                            deleteDraftTicketAttachmentImagesAction={deleteDraftTicketAttachmentImagesAction}
                            resolveTicketAttachmentViewUrl={resolveTicketAttachmentViewUrl}
                            onOpenEmailNotificationLogs={() => setIsEmailNotificationLogsDrawerOpen(true)}
                            onOpenActivityLog={capabilities.activityLog ? () => {
                                setActivityLogRefreshKey((value) => value + 1);
                                setIsActivityLogDrawerOpen(true);
                            } : undefined}
                            hideSlaStatus={effectiveHideSlaStatus}
                            additionalAgents={additionalAgentsForInfo}
                            onLiveDirtyFieldsChange={setTicketInfoDirtyFields}
                            liveHighlightedFields={liveHighlightedFields}
                            liveFieldConflicts={liveFieldConflicts}
                            liveFrozenFields={frozenFieldList}
                            onKeepLiveConflict={handleKeepLiveConflict}
                            onTakeLiveConflict={handleTakeLiveConflict}
                            liveEditingUsers={liveEditingUsers}
                            onLiveEditingFieldChange={ticketLive.setEditingField}
                        />
                    ) : null}
                    {isAllFieldsDrawerOpen ? (
                        <div id={`${id}-all-fields-extras`} className="mt-4 pt-4 border-t border-[rgb(var(--color-border-200))] grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <Label htmlFor={`${id}-all-fields-contact-select`}>{t('properties.contact', 'Contact')}</Label>
                                <CustomSelect
                                    id={`${id}-all-fields-contact-select`}
                                    value={ticket.contact_name_id ?? 'none'}
                                    options={[
                                        { value: 'none', label: t('info.noContact', 'No contact') },
                                        ...contacts.map((contact) => ({
                                            value: contact.contact_name_id,
                                            label: contact.full_name,
                                        })),
                                    ]}
                                    onValueChange={(value: string) =>
                                        void handleContactChange(value === 'none' ? null : value)
                                    }
                                    className="!w-full"
                                    disabled={dataSource.screen.readOnly === true}
                                />
                            </div>
                            <div>
                                <Label htmlFor={`${id}-all-fields-location-select`}>{t('fields.location', 'Location')}</Label>
                                <CustomSelect
                                    id={`${id}-all-fields-location-select`}
                                    value={ticket.location_id ?? 'none'}
                                    options={[
                                        { value: 'none', label: t('bento.tiles.noLocation', 'No location') },
                                        ...locations.map((location) => ({
                                            value: location.location_id,
                                            label: [location.location_name, location.address_line1]
                                                .filter(Boolean)
                                                .join(' – ') || location.location_id,
                                        })),
                                    ]}
                                    onValueChange={(value: string) =>
                                        void handleLocationChange(value === 'none' ? null : value)
                                    }
                                    className="!w-full"
                                    disabled={dataSource.screen.readOnly === true}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>
            </Drawer>
            {capabilities.emailLogs ? (
            <Drawer
                id={`${id}-email-notification-logs-drawer`}
                isOpen={isEmailNotificationLogsDrawerOpen}
                onClose={() => setIsEmailNotificationLogsDrawerOpen(false)}
                width="48rem"
            >
                <div className="space-y-4 pr-8">
                    <div className="flex items-center gap-2">
                        <Mail className="h-5 w-5 text-[rgb(var(--color-text-700))]" />
                        <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                            {t('info.emailNotificationLogs', 'Email Notification Logs')}
                        </h2>
                    </div>
                    <TicketEmailNotifications
                        id={`${id}-email-notifications`}
                        ticketId={ticket.ticket_id || ''}
                        variant="flat"
                    />
                </div>
            </Drawer>
            ) : null}
            {capabilities.activityLog ? (
            <Drawer
                id="ticket-activity-log-drawer"
                isOpen={isActivityLogDrawerOpen}
                onClose={() => setIsActivityLogDrawerOpen(false)}
                width="48rem"
            >
                <div className="space-y-4 pr-8">
                    <div className="flex items-center gap-2">
                        <History className="h-5 w-5 text-[rgb(var(--color-text-700))]" />
                        <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                            {t('info.ticketActivity', 'Ticket Activity')}
                        </h2>
                    </div>
                    {ticket.ticket_id ? (
                        <TicketActivityTimeline
                            ticketId={ticket.ticket_id}
                            refreshKey={conversations.length + activityLogRefreshKey}
                        />
                    ) : null}
                </div>
            </Drawer>
            ) : null}
            {isPrintWorkTagOpen && (
                <LabelPrintDialog
                    isOpen={isPrintWorkTagOpen}
                    onClose={() => setIsPrintWorkTagOpen(false)}
                    labelClass="ticket-work-tag"
                    ids={[ticket.ticket_id as string]}
                    defaultTitle={ticket.title ?? ''}
                    defaultDetail={printWorkReason}
                    idPrefix={`${id}-print-work-tag`}
                />
            )}
        </ReflectionContainer>
    );
};

export default TicketDetails;
