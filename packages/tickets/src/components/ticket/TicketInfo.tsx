// @ts-nocheck
// TODO: Priority index signature issue
'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { RichTextViewer, TextEditor } from '@alga-psa/ui/editor';
import { PartialBlock } from '@blocknote/core';
import { ITicket, IComment, ITicketCategory } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { TicketResponseState } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { PrioritySelect } from '@alga-psa/ui/components/tickets/PrioritySelect';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { getUserAvatarUrlsBatchAction, searchUsersForMentions } from '@alga-psa/user-composition/actions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { CategoryPicker } from '../CategoryPicker';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { TimePicker } from '@alga-psa/ui/components/TimePicker';
import { format, setHours, setMinutes } from 'date-fns';
import { TagManager } from '@alga-psa/tags/components';
import { ResponseStateDisplay } from '../ResponseStateSelect';
import styles from './TicketDetails.module.css';
import { getTicketCategories, getTicketCategoriesByBoard, BoardCategoryData } from '../../actions/ticketCategoryActions';
import { ItilLabels, calculateItilPriority } from '@alga-psa/tickets/lib/itilUtils';
import { Pencil, Check, X, HelpCircle, Save, PauseCircle, Users, Mail, History } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Badge } from '@alga-psa/ui/components/Badge';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import QuickAddCategory from '../QuickAddCategory';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useRegisterUnsavedChanges } from '@alga-psa/ui/context';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import type { SlaTimerStatus } from '@alga-psa/types';
import { SlaStatusBadge } from '@alga-psa/ui/components/sla';
import type { ITeam } from '@alga-psa/types';
import { useSession } from 'next-auth/react';
import { FieldConflictBanner } from '@alga-psa/ui/presence/FieldConflictBanner';
import { parseTicketRichTextContent, serializeTicketRichTextContent } from '../../lib/ticketRichText';
import { useTicketRichTextUploadSession } from './useTicketRichTextUploadSession';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TicketLiveConflictState } from './ticketLiveFields';
import { usePageSaveShortcut, usePanelSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { useInsideDrawer } from '@alga-psa/ui/components/ModalityContext';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import TicketNotificationSuppressionControl, {
  type TicketNotificationSuppressionValue,
} from './TicketNotificationSuppressionControl';

const isReturnedActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

interface TicketInfoProps {
  id: string; // Made required since it's needed for reflection registration
  ticket: ITicket;
  conversations: IComment[];
  statusOptions: { value: string; label: string }[];
  agentOptions: { value: string; label: string }[];
  boardOptions: { value: string; label: string }[];
  priorityOptions: { value: string; label: string }[];
  onSelectChange: (field: keyof ITicket, newValue: string | null) => void;
  onSaveChanges?: (
    changes: Record<string, unknown>,
    options?: TicketNotificationSuppressionValue
  ) => Promise<boolean>;
  onUpdateDescription?: (content: string) => Promise<boolean>;
  isSubmitting?: boolean;
  users?: IUserWithRoles[];
  tags?: ITag[];
  allTagTexts?: string[];
  onTagsChange?: (tags: ITag[]) => void;
  isInDrawer?: boolean;
  onItilFieldChange?: (field: 'itil_impact' | 'itil_urgency', value: number | null) => void;
  isBundledChild?: boolean;
  // Pre-fetched categories from server to avoid timing issues
  initialCategories?: ITicketCategory[];
  // Local ITIL state values
  itilImpact?: number;
  itilUrgency?: number;
  itilCategory?: string;
  itilSubcategory?: string;
  renderProjectTaskActions?: (args: { ticket: ITicket; additionalAgents?: { user_id: string; name: string }[] }) => React.ReactNode;
  additionalAgents?: { user_id: string; name: string }[];
  responseStateTrackingEnabled?: boolean;
  teams?: ITeam[];
  onAssignTeam?: (teamId: string, options?: TicketNotificationSuppressionValue) => Promise<void>;
  onRemoveTeamAssignment?: () => Promise<void>;
  onClipboardImageUploaded?: () => Promise<void> | void;
  uploadTicketAttachmentAction?: (
    formData: FormData,
    params: { userId: string; ticketId: string }
  ) => Promise<any>;
  deleteDraftTicketAttachmentImagesAction?: (input: {
    ticketId: string;
    documentIds: string[];
  }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
  resolveTicketAttachmentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
  onOpenEmailNotificationLogs?: () => void;
  onOpenActivityLog?: () => void;
  titleRef?: React.Ref<HTMLHeadingElement>;
  hideSlaStatus?: boolean;
  onLiveDirtyFieldsChange?: (fields: string[]) => void;
  liveHighlightedFields?: string[];
  liveFrozenFields?: string[];
  liveFieldConflicts?: Partial<Record<string, TicketLiveConflictState>>;
  onKeepLiveConflict?: (field: string) => void;
  onTakeLiveConflict?: (field: string) => void;
  liveEditingUsers?: Partial<Record<string, string[]>>;
  onLiveEditingFieldChange?: (field: string | null) => void;
}

const TicketInfo: React.FC<TicketInfoProps> = ({
  id,
  ticket,
  conversations,
  statusOptions,
  agentOptions,
  boardOptions,
  priorityOptions,
  onSelectChange,
  onSaveChanges,
  onUpdateDescription,
  isSubmitting = false,
  users = [],
  tags = [],
  onTagsChange,
  isInDrawer = false,
  onItilFieldChange,
  isBundledChild = false,
  initialCategories = [],
  itilImpact,
  itilUrgency,
  itilCategory,
  itilSubcategory,
  renderProjectTaskActions,
  additionalAgents,
  responseStateTrackingEnabled = true,
  teams = [],
  onAssignTeam,
  onRemoveTeamAssignment,
  onClipboardImageUploaded,
  uploadTicketAttachmentAction,
  deleteDraftTicketAttachmentImagesAction,
  resolveTicketAttachmentViewUrl,
  onOpenEmailNotificationLogs,
  onOpenActivityLog,
  titleRef,
  hideSlaStatus = false,
  onLiveDirtyFieldsChange,
  liveHighlightedFields = [],
  liveFrozenFields = [],
  liveFieldConflicts = {},
  onKeepLiveConflict,
  onTakeLiveConflict,
  liveEditingUsers = {},
  onLiveEditingFieldChange,
}) => {
  const { data: session } = useSession();
  const { t } = useTranslation('features/tickets');
  const { deleteDocument } = useDocumentsCrossFeature();
  // Use initialCategories from server to avoid timing issues on first render
  const [categories, setCategories] = useState<ITicketCategory[]>(initialCategories);
  const [boardConfig, setBoardConfig] = useState<BoardCategoryData['boardConfig']>({
    category_type: 'custom',
    priority_type: 'custom',
    display_itil_impact: false,
    display_itil_urgency: false,
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(ticket.title);
  const [showPriorityMatrix, setShowPriorityMatrix] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const workflowLocked = isBundledChild;

  // Local state for pending changes (not saved until Save Changes is clicked)
  const [pendingChanges, setPendingChanges] = useState<Partial<ITicket>>({});
  const [pendingItilChanges, setPendingItilChanges] = useState<{ itil_impact?: number | null; itil_urgency?: number | null }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [notificationSuppression, setNotificationSuppression] = useState<TicketNotificationSuppressionValue>({
    suppressContactNotifications: false,
    suppressInternalNotifications: false,
  });
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [additionalAgentAvatarUrls, setAdditionalAgentAvatarUrls] = useState<Record<string, string | null>>({});
  const [teamAvatarUrl, setTeamAvatarUrl] = useState<string | null>(null);
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const [pendingTeamRemoval, setPendingTeamRemoval] = useState(false);
  const highlightedFieldSet = useMemo(() => new Set(liveHighlightedFields), [liveHighlightedFields]);
  const frozenFieldSet = useMemo(() => new Set(liveFrozenFields), [liveFrozenFields]);

  // Capture original ticket values when form is initialized
  const [originalTicketValues, setOriginalTicketValues] = useState<Partial<ITicket>>(() => ({
    status_id: ticket.status_id,
    assigned_to: ticket.assigned_to,
    board_id: ticket.board_id,
    category_id: ticket.category_id,
    subcategory_id: ticket.subcategory_id,
    priority_id: ticket.priority_id,
    due_date: ticket.due_date,
    response_state: ticket.response_state,
    title: ticket.title,
  }));

  // Keep "original" values in sync when the upstream ticket changes (e.g. response_state updates after save).
  // Only sync fields the user isn't actively editing in this form.
  useEffect(() => {
    if (!ticket || !isFormInitialized) return;

    const syncFields: (keyof ITicket)[] = [
      'status_id',
      'assigned_to',
      'board_id',
      'category_id',
      'subcategory_id',
      'priority_id',
      'due_date',
      'response_state',
      'title',
    ];

    setOriginalTicketValues((prev) => {
      let changed = false;
      const next: Partial<ITicket> = { ...prev };

      for (const field of syncFields) {
        if (field in pendingChanges) continue;
        const incoming = (ticket as any)[field];
        if ((prev as any)[field] !== incoming) {
          (next as any)[field] = incoming;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [ticket, pendingChanges, isFormInitialized]);

  // Local state for board config based on selected (pending) board
  const [pendingBoardConfig, setPendingBoardConfig] = useState<BoardCategoryData['boardConfig'] | null>(null);
  const [pendingCategories, setPendingCategories] = useState<ITicketCategory[] | null>(null);
  const [isQuickAddCategoryOpen, setIsQuickAddCategoryOpen] = useState(false);

  // Get the effective board ID (pending or saved)
  const effectiveBoardId = pendingChanges.board_id ?? originalTicketValues.board_id;
  const hasPendingStatusOverride = Object.prototype.hasOwnProperty.call(pendingChanges, 'status_id');
  const pendingStatusValue = hasPendingStatusOverride
    ? (pendingChanges.status_id ?? '')
    : (originalTicketValues.status_id ?? '');
  const requiresDestinationStatusSelection = Boolean(
    pendingChanges.board_id &&
    pendingChanges.board_id !== originalTicketValues.board_id &&
    !pendingChanges.status_id
  );

  // Get the effective board config (pending or current)
  const effectiveBoardConfig = pendingBoardConfig ?? boardConfig;

  // Get the effective categories (pending or current)
  const effectiveCategories = pendingCategories ?? categories;

  // Calculate ITIL priority when impact and urgency are available
  // Use pending ITIL values if available, otherwise use prop values
  const effectiveItilImpact = pendingItilChanges.itil_impact ?? itilImpact;
  const effectiveItilUrgency = pendingItilChanges.itil_urgency ?? itilUrgency;

  const calculatedItilPriority = useMemo(() => {
    if (effectiveItilImpact && effectiveItilUrgency) {
      try {
        return calculateItilPriority(effectiveItilImpact, effectiveItilUrgency);
      } catch {
        return null;
      }
    }
    return null;
  }, [effectiveItilImpact, effectiveItilUrgency]);

  // Store original description when entering edit mode (for cancel reset)
  const originalDescriptionRef = useRef<PartialBlock[] | null>(null);
  // Track if description content has actually changed from original
  const [hasDescriptionContentChanged, setHasDescriptionContentChanged] = useState(false);

  // Track if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!isFormInitialized) {
      return false;
    }

    // Check if any pending changes exist
    const hasPendingTicketChanges = Object.keys(pendingChanges).length > 0;
    const hasPendingItilChanges = Object.keys(pendingItilChanges).length > 0;
    const hasTitleChange = titleValue !== ticket.title;
    const hasDescriptionChange = hasDescriptionContentChanged;

    return hasPendingTicketChanges || hasPendingItilChanges || hasTitleChange || hasDescriptionChange || pendingTeamId !== null || pendingTeamRemoval;
  }, [isFormInitialized, pendingChanges, pendingItilChanges, titleValue, ticket.title, hasDescriptionContentChanged, pendingTeamId, pendingTeamRemoval]);

  // Register unsaved changes with the context
  useRegisterUnsavedChanges(`ticket-info-${id}`, hasUnsavedChanges);

  // Initialize form when ticket loads
  useEffect(() => {
    if (ticket && !isFormInitialized) {
      setTitleValue(ticket.title);
      setPendingChanges({});
      setPendingItilChanges({});
      setPendingBoardConfig(null);
      setPendingCategories(null);
      setIsFormInitialized(true);
    }
  }, [ticket, isFormInitialized]);

  useEffect(() => {
    const dirtyFields = new Set<string>();

    for (const field of Object.keys(pendingChanges)) {
      dirtyFields.add(field);
    }

    for (const field of Object.keys(pendingItilChanges)) {
      dirtyFields.add(field);
    }

    if (isEditingTitle && titleValue !== ticket.title) {
      dirtyFields.add('title');
    }

    onLiveDirtyFieldsChange?.(Array.from(dirtyFields));
  }, [
    isEditingTitle,
    onLiveDirtyFieldsChange,
    pendingChanges,
    pendingItilChanges,
    ticket.title,
    titleValue,
  ]);

  useEffect(() => {
    return () => {
      onLiveDirtyFieldsChange?.([]);
    };
  }, [onLiveDirtyFieldsChange]);

  // Track loading state for board config
  const [isLoadingBoardConfig, setIsLoadingBoardConfig] = useState(false);
  const [isLoadingStatusOptions, setIsLoadingStatusOptions] = useState(false);
  const [boardScopedStatusOptions, setBoardScopedStatusOptions] = useState(statusOptions);
  const fetchingBoardIdRef = useRef<string | null>(null);
  const saveSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
    };
  }, []);

  // Fetch avatar URLs for additional agents
  useEffect(() => {
    if (!additionalAgents?.length || !ticket.tenant) {
      setAdditionalAgentAvatarUrls({});
      return;
    }
    const fetchAvatars = async () => {
      try {
        const userIds = additionalAgents.map(a => a.user_id);
        const result = await getUserAvatarUrlsBatchAction(userIds, ticket.tenant);
        const urls: Record<string, string | null> = {};
        if (result && typeof (result as Map<string, string | null>).forEach === 'function') {
          (result as Map<string, string | null>).forEach((v, k) => { urls[k] = v; });
        } else {
          Object.assign(urls, result);
        }
        setAdditionalAgentAvatarUrls(urls);
      } catch {
        setAdditionalAgentAvatarUrls({});
      }
    };
    fetchAvatars();
  }, [additionalAgents, ticket.tenant]);

  useEffect(() => {
    let isMounted = true;

    const loadBoardStatuses = async () => {
      if (!effectiveBoardId) {
        setBoardScopedStatusOptions([]);
        setIsLoadingStatusOptions(false);
        return;
      }

      setIsLoadingStatusOptions(true);
      try {
        const statuses = await getTicketStatuses(effectiveBoardId);
        if (!isMounted) {
          return;
        }

        setBoardScopedStatusOptions(
          statuses.map((status) => ({
            value: status.status_id,
            label: status.name ?? '',
          }))
        );
      } catch (error) {
        console.error('Error loading board ticket statuses:', error);
        if (isMounted) {
          setBoardScopedStatusOptions([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingStatusOptions(false);
        }
      }
    };

    loadBoardStatuses();

    return () => {
      isMounted = false;
    };
  }, [effectiveBoardId]);

  // Fetch team avatar (for saved or pending team)
  useEffect(() => {
    const effectiveTeamId = pendingTeamId || ticket.assigned_team_id;
    if (!effectiveTeamId || !ticket.tenant) {
      setTeamAvatarUrl(null);
      return;
    }
    const fetchTeamAvatar = async () => {
      try {
        const result = await getTeamAvatarUrlsBatchAction([effectiveTeamId], ticket.tenant);
        if (result && typeof (result as Map<string, string | null>).get === 'function') {
          setTeamAvatarUrl((result as Map<string, string | null>).get(effectiveTeamId) ?? null);
        } else {
          setTeamAvatarUrl((result as unknown as Record<string, string | null>)[effectiveTeamId] ?? null);
        }
      } catch {
        setTeamAvatarUrl(null);
      }
    };
    fetchTeamAvatar();
  }, [pendingTeamId, ticket.assigned_team_id, ticket.tenant]);

  // Track current board's priority type in a ref
  const currentPriorityTypeRef = useRef(boardConfig.priority_type);
  useEffect(() => {
    currentPriorityTypeRef.current = boardConfig.priority_type;
  }, [boardConfig.priority_type]);

  // Fetch board config when pending board changes
  useEffect(() => {
    const boardIdToFetch = pendingChanges.board_id;

    const fetchPendingBoardConfig = async () => {
      if (boardIdToFetch && boardIdToFetch !== ticket.board_id) {
        fetchingBoardIdRef.current = boardIdToFetch;
        setPendingCategories([]);
        // Don't clear pendingBoardConfig here - keep showing previous config until new one loads
        setIsLoadingBoardConfig(true);

        try {
          const data = await getTicketCategoriesByBoard(boardIdToFetch);

          if (fetchingBoardIdRef.current === boardIdToFetch) {
            if (isReturnedActionError(data)) {
              console.warn('Failed to fetch pending board config:', getErrorMessage(data));
              setPendingCategories([]);
              setPendingBoardConfig(null);
              setIsLoadingBoardConfig(false);
              return;
            }
            if (data && data.categories) {
              const categoriesArray = Array.isArray(data.categories) ? data.categories : [];
              setPendingCategories(categoriesArray);
              if (data.boardConfig) {
                setPendingBoardConfig(data.boardConfig);

                const currentPriorityType = currentPriorityTypeRef.current;
                const newPriorityType = data.boardConfig.priority_type;

                if (currentPriorityType !== newPriorityType) {
                  setPendingChanges(prev => ({
                    ...prev,
                    priority_id: null,
                  }));
                  setPendingItilChanges({ itil_impact: null, itil_urgency: null });
                }
              }
            }
            setIsLoadingBoardConfig(false);
          }
        } catch (error) {
          if (fetchingBoardIdRef.current === boardIdToFetch) {
            console.error('Failed to fetch pending board config:', error);
            setIsLoadingBoardConfig(false);
          }
        }
      } else if (!boardIdToFetch) {
        fetchingBoardIdRef.current = null;
        setPendingBoardConfig(null);
        setPendingCategories(null);
        setIsLoadingBoardConfig(false);
      }
    };

    fetchPendingBoardConfig();
  }, [pendingChanges.board_id, ticket.board_id]);

  // Get ITIL categories from props (now includes both custom and ITIL)
  // NOTE: Categories are now unified - no need for separate ITIL category filtering

  // NOTE: ITIL category selection is now handled by the unified CategoryPicker system

  // NOTE: ITIL category selection is now handled by the unified CategoryPicker
  // Categories are managed through the regular onCategoryChange handler

  const [descriptionContent, setDescriptionContent] = useState<PartialBlock[]>(() =>
    parseTicketRichTextContent(ticket.attributes?.description as string | object | undefined)
  );

  const discardDescriptionEdit = useCallback(() => {
    const originalDescription =
      originalDescriptionRef.current ??
      parseTicketRichTextContent(ticket.attributes?.description as string | object | undefined);
    setDescriptionContent(originalDescription);
    setHasDescriptionContentChanged(false);
    setIsEditingDescription(false);
  }, [ticket.attributes?.description]);

  const descriptionUploadSession = useTicketRichTextUploadSession({
    componentLabel: 'TicketInfo',
    ticketId: ticket.ticket_id,
    userId: session?.user?.id,
    trackDraftUploads: true,
    onDocumentsChanged: onClipboardImageUploaded,
    onDiscard: discardDescriptionEdit,
    uploadDocumentAction: uploadTicketAttachmentAction,
    deleteDraftClipboardImagesAction: deleteDraftTicketAttachmentImagesAction,
    resolveDocumentViewUrl: resolveTicketAttachmentViewUrl,
    deleteDocumentFn: deleteDocument,
  });

  useEffect(() => {
    if (isEditingDescription) {
      return;
    }

    const parsedDescription = parseTicketRichTextContent(
      ticket.attributes?.description as string | object | undefined
    );
    setDescriptionContent(parsedDescription);
    originalDescriptionRef.current = parsedDescription;
    setHasDescriptionContentChanged(false);
  }, [ticket.attributes?.description, isEditingDescription]);

  // Sync categories with initialCategories when they change
  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }, [initialCategories]);

  // Separate useEffect for fetching categories based on board
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        if (ticket.board_id) {
          // Fetch categories for the specific board
          const data = await getTicketCategoriesByBoard(ticket.board_id);
          if (isReturnedActionError(data)) {
            console.warn('Failed to fetch ticket categories:', getErrorMessage(data));
            setCategories([]);
            setBoardConfig({
              category_type: 'custom',
              priority_type: 'custom',
              display_itil_impact: false,
              display_itil_urgency: false,
            });
            return;
          }
          // Ensure data is properly resolved and categories is an array
          if (data && data.categories) {
            // Extra safety check - ensure it's actually an array
            const categoriesArray = Array.isArray(data.categories) ? data.categories : [];
            setCategories(categoriesArray);
            if (data.boardConfig) {
              setBoardConfig(data.boardConfig);
            }
          } else {
            console.error('Invalid categories data received:', data);
            setCategories([]);
            setBoardConfig({
              category_type: 'custom',
              priority_type: 'custom',
              display_itil_impact: false,
              display_itil_urgency: false,
              });
          }
        } else {
          // If no board, fetch all categories and use custom categories
          const fetchedCategories = await getTicketCategories();
          if (isReturnedActionError(fetchedCategories)) {
            console.warn('Failed to fetch ticket categories:', getErrorMessage(fetchedCategories));
            setCategories([]);
            setBoardConfig({
              category_type: 'custom',
              priority_type: 'custom',
              display_itil_impact: false,
              display_itil_urgency: false,
            });
            return;
          }
          // Ensure fetchedCategories is an array
          if (Array.isArray(fetchedCategories)) {
            setCategories(fetchedCategories);
          } else {
            console.error('Invalid categories data received:', fetchedCategories);
            setCategories([]);
          }
          setBoardConfig({
            category_type: 'custom',
            priority_type: 'custom',
            display_itil_impact: false,
            display_itil_urgency: false,
          });
        }
      } catch (error) {
        console.error('Failed to fetch categories:', error);
        // Set empty defaults on error
        setCategories([]);
        setBoardConfig({
          category_type: 'custom',
          priority_type: 'custom',
          display_itil_impact: false,
          display_itil_urgency: false,
        });
      }
    };

    fetchCategories();
  }, [ticket.board_id]); // Re-fetch when board changes

  useEffect(() => {
    if (isEditingTitle && titleValue !== ticket.title) {
      return;
    }

    setTitleValue(ticket.title);
  }, [isEditingTitle, ticket.title, titleValue]);

  const isFieldHighlighted = useCallback((field: string) => highlightedFieldSet.has(field), [highlightedFieldSet]);

  const isFieldFrozen = useCallback((field: string) => {
    return frozenFieldSet.has(field) || Boolean(liveFieldConflicts[field]);
  }, [frozenFieldSet, liveFieldConflicts]);

  const getFieldContainerClassName = useCallback((field: string) => {
    const classes = ['rounded-lg transition-colors duration-[600ms]'];

    if (isFieldHighlighted(field)) {
      classes.push('bg-sky-50 ring-1 ring-sky-200 px-3 py-2');
    }

    if (isFieldFrozen(field)) {
      classes.push('opacity-80');
    }

    return classes.join(' ');
  }, [isFieldFrozen, isFieldHighlighted]);

  const getEditingUsersForField = useCallback((field: string) => liveEditingUsers[field] ?? [], [liveEditingUsers]);

  const getEditingCaption = useCallback((field: string) => {
    const editingUsers = getEditingUsersForField(field);
    if (editingUsers.length === 0) {
      return null;
    }

    if (editingUsers.length === 1) {
      return t('liveUpdates.editing.single', '{{name}} is editing')
        .replace('{{name}}', editingUsers[0]);
    }

    return t(
      editingUsers.length === 2 ? 'liveUpdates.editing.multiple_one' : 'liveUpdates.editing.multiple_other',
      editingUsers.length === 2
        ? '{{name}} and {{count}} other are editing'
        : '{{name}} and {{count}} others are editing'
    )
      .replace('{{name}}', editingUsers[0])
      .replace('{{count}}', String(editingUsers.length - 1));
  }, [getEditingUsersForField, t]);

  const isFieldRemotelyEdited = useCallback((field: string) => {
    return getEditingUsersForField(field).length > 0;
  }, [getEditingUsersForField]);

  const createEditingFieldHandlers = useCallback((field: string) => ({
    onFocusCapture: () => {
      onLiveEditingFieldChange?.(field);
    },
    onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        onLiveEditingFieldChange?.(null);
      }
    },
  }), [onLiveEditingFieldChange]);

  const clearPendingChangeFields = useCallback((fields: string[]) => {
    setPendingChanges((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const field of fields) {
        if (field in next) {
          changed = true;
          delete (next as Partial<ITicket>)[field as keyof ITicket];
        }
      }

      return changed ? next : prev;
    });
  }, []);

  const handleKeepLiveConflict = useCallback((field: string) => {
    onKeepLiveConflict?.(field);
  }, [onKeepLiveConflict]);

  const handleTakeLiveConflict = useCallback((field: string) => {
    switch (field) {
      case 'title':
        setTitleValue(ticket.title);
        setIsEditingTitle(false);
        break;
      case 'status_id':
      case 'assigned_to':
      case 'priority_id':
      case 'response_state':
      case 'due_date':
        clearPendingChangeFields([field]);
        break;
      case 'board_id':
        clearPendingChangeFields(['board_id', 'status_id', 'category_id', 'subcategory_id']);
        setPendingBoardConfig(null);
        setPendingCategories(null);
        break;
      case 'category_id':
        clearPendingChangeFields(['category_id', 'subcategory_id']);
        break;
      case 'itil_impact':
      case 'itil_urgency':
        setPendingItilChanges((prev) => {
          if (!(field in prev)) {
            return prev;
          }

          const next = { ...prev };
          delete next[field];
          return next;
        });
        break;
      default:
        clearPendingChangeFields([field]);
        break;
    }

    if (field === 'assigned_to') {
      setPendingTeamId(null);
      setPendingTeamRemoval(false);
    }

    onTakeLiveConflict?.(field);
  }, [clearPendingChangeFields, onTakeLiveConflict, ticket.title]);

  // If we don't have users data but have agentOptions, convert agentOptions to users format
  const usersList: IUserWithRoles[] = users.length > 0
    ? users
    : agentOptions.map((agent): IUserWithRoles => ({
        user_id: agent.value,
        username: agent.value,
        first_name: agent.label.split(' ')[0] || '',
        last_name: agent.label.split(' ').slice(1).join(' ') || '',
        email: '',
        hashed_password: '',
        is_inactive: false,
        tenant: '',
        user_type: 'internal',
        roles: []
      }));

  const getConflictRemoteValue = useCallback((field: string): React.ReactNode => {
    switch (field) {
      case 'title':
        return ticket.title || t('properties.notAvailable', 'N/A');
      case 'status_id':
        return boardScopedStatusOptions.find((option) => option.value === ticket.status_id)?.label
          ?? ticket.status_name
          ?? t('properties.notAvailable', 'N/A');
      case 'assigned_to':
        return usersList.find((user) => user.user_id === ticket.assigned_to)
          ? `${usersList.find((user) => user.user_id === ticket.assigned_to)?.first_name ?? ''} ${usersList.find((user) => user.user_id === ticket.assigned_to)?.last_name ?? ''}`.trim()
          : t('info.notAssigned', 'Not assigned');
      case 'board_id':
        return boardOptions.find((option) => option.value === ticket.board_id)?.label ?? t('properties.notAvailable', 'N/A');
      case 'category_id': {
        const categoryLookup = effectiveCategories.find((category) => category.category_id === ticket.subcategory_id)
          ?? effectiveCategories.find((category) => category.category_id === ticket.category_id);
        return categoryLookup?.category_name ?? t('properties.notAvailable', 'N/A');
      }
      case 'priority_id':
        return priorityOptions.find((option) => option.value === ticket.priority_id)?.label ?? t('properties.notAvailable', 'N/A');
      case 'response_state':
        return ticket.response_state ?? t('properties.notAvailable', 'N/A');
      case 'due_date':
        return ticket.due_date ?? t('properties.notAvailable', 'N/A');
      case 'itil_impact':
        return ticket.itil_impact ? `${ticket.itil_impact} - ${t(`itil.level.${ticket.itil_impact}` as const, ItilLabels.impact[ticket.itil_impact])}` : t('properties.notAvailable', 'N/A');
      case 'itil_urgency':
        return ticket.itil_urgency ? `${ticket.itil_urgency} - ${t(`itil.level.${ticket.itil_urgency}` as const, ItilLabels.urgency[ticket.itil_urgency])}` : t('properties.notAvailable', 'N/A');
      default:
        return t('properties.notAvailable', 'N/A');
    }
  }, [boardOptions, boardScopedStatusOptions, effectiveCategories, priorityOptions, t, ticket, usersList]);
  const hasActiveLiveConflict = Object.keys(liveFieldConflicts).length > 0;

  // Handler for title save (saves immediately when checkmark is clicked)
  const handleTitleSubmit = useCallback(() => {
    if (titleValue.trim() !== '' && titleValue.trim() !== ticket.title) {
      onSelectChange('title', titleValue.trim());
      setIsEditingTitle(false);
    } else {
      setIsEditingTitle(false);
    }
  }, [titleValue, ticket.title, onSelectChange]);

  // Handler for title cancel
  const handleTitleCancel = useCallback(() => {
    setTitleValue(ticket.title);
    setIsEditingTitle(false);
  }, [ticket.title]);

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleTitleCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSubmit();
    }
  };

  // Handler for pending field changes (not saved until Save Changes is clicked)
  const handlePendingChange = useCallback((field: keyof ITicket, value: string | null) => {
    setPendingChanges(prev => {
      if (value === originalTicketValues[field]) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: value };
    });
  }, [originalTicketValues]);

  // Handler for pending ITIL field changes
  const handlePendingItilChange = useCallback((field: 'itil_impact' | 'itil_urgency', value: number | null) => {
    setPendingItilChanges(prev => {
      const originalValue = field === 'itil_impact' ? itilImpact : itilUrgency;
      if (value === originalValue) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: value };
    });
  }, [itilImpact, itilUrgency]);

  const finalizeSavedDescription = useCallback(() => {
    originalDescriptionRef.current = descriptionContent;
    descriptionUploadSession.resetDraftTracking();
    setHasDescriptionContentChanged(false);
    setIsEditingDescription(false);
  }, [descriptionContent, descriptionUploadSession]);

  const persistDescriptionChanges = useCallback(async () => {
    if (!isEditingDescription || !onUpdateDescription) {
      return true;
    }

    return onUpdateDescription(serializeTicketRichTextContent(descriptionContent));
  }, [descriptionContent, isEditingDescription, onUpdateDescription]);

  // Handler for saving all pending changes
  const handleSaveChanges = useCallback(async () => {
    if (!hasUnsavedChanges || requiresDestinationStatusSelection || hasActiveLiveConflict) return;

    setIsSaving(true);
    try {
      const allChanges: Record<string, unknown> = { ...pendingChanges };

      if (titleValue !== ticket.title) {
        allChanges.title = titleValue;
      }

      if (Object.keys(pendingItilChanges).length > 0) {
        if ('itil_impact' in pendingItilChanges) {
          allChanges.itil_impact = pendingItilChanges.itil_impact;
        }
        if ('itil_urgency' in pendingItilChanges) {
          allChanges.itil_urgency = pendingItilChanges.itil_urgency;
        }
      }

      if (isEditingDescription) {
        const descriptionSaved = await persistDescriptionChanges();
        if (!descriptionSaved) {
          return;
        }
      }

      const saveOptions = notificationSuppression.suppressContactNotifications
        ? notificationSuppression
        : undefined;

      // Assign team if pending (fires server action for member expansion)
      if (pendingTeamId && onAssignTeam) {
        await onAssignTeam(pendingTeamId, saveOptions);
        setPendingTeamId(null);
      }

      // Remove team if pending removal (user switched to individual agent)
      if (pendingTeamRemoval && onRemoveTeamAssignment) {
        await onRemoveTeamAssignment();
        setPendingTeamRemoval(false);
      }

      if (onSaveChanges) {
        const success = saveOptions
          ? await onSaveChanges(allChanges, saveOptions)
          : await onSaveChanges(allChanges);
        if (success) {
          setOriginalTicketValues(prev => ({
            ...prev,
            ...allChanges,
            ...(allChanges.title ? { title: allChanges.title as string } : {}),
          }));
          setPendingChanges({});
          setPendingItilChanges({});
          setNotificationSuppression({
            suppressContactNotifications: false,
            suppressInternalNotifications: false,
          });
          setPendingBoardConfig(null);
          setPendingCategories(null);
          if (isEditingDescription) {
            finalizeSavedDescription();
          }
          setIsEditingTitle(false);
          setSaveSuccess(true);
          if (saveSuccessTimeoutRef.current) {
            clearTimeout(saveSuccessTimeoutRef.current);
          }
          saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
        }
      } else {
        for (const [field, value] of Object.entries(allChanges)) {
          if (field === 'itil_impact' || field === 'itil_urgency') {
            if (onItilFieldChange) {
              onItilFieldChange(field as 'itil_impact' | 'itil_urgency', value as number | null);
            }
          } else {
            onSelectChange(field as keyof ITicket, value as string | null);
          }
        }
        setOriginalTicketValues(prev => ({
          ...prev,
          ...allChanges,
          ...(allChanges.title ? { title: allChanges.title as string } : {}),
        }));
        setPendingChanges({});
        setPendingItilChanges({});
        setNotificationSuppression({
          suppressContactNotifications: false,
          suppressInternalNotifications: false,
        });
        setPendingBoardConfig(null);
        setPendingCategories(null);
        if (isEditingDescription) {
          finalizeSavedDescription();
        }
        setIsEditingTitle(false);
        setSaveSuccess(true);
        if (saveSuccessTimeoutRef.current) {
          clearTimeout(saveSuccessTimeoutRef.current);
        }
        saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (error) {
      console.error('Error saving changes:', error);
    } finally {
      setIsSaving(false);
    }
  }, [finalizeSavedDescription, hasActiveLiveConflict, hasUnsavedChanges, isEditingDescription, notificationSuppression, onAssignTeam, onItilFieldChange, onRemoveTeamAssignment, onSaveChanges, onSelectChange, pendingChanges, pendingItilChanges, pendingTeamId, pendingTeamRemoval, persistDescriptionChanges, requiresDestinationStatusSelection, ticket.title, titleValue]);

  // Inside a drawer (e.g. the bento "All fields" drawer) the panel scope
  // suppresses page.save, so the save shortcut registers as panel.submit there.
  const insideDrawer = useInsideDrawer();
  const canSaveViaShortcut = hasUnsavedChanges && !requiresDestinationStatusSelection && !hasActiveLiveConflict;
  usePageSaveShortcut(handleSaveChanges, {
    enabled: !insideDrawer && canSaveViaShortcut,
  });
  usePanelSubmitShortcut(handleSaveChanges, {
    enabled: insideDrawer && canSaveViaShortcut,
  });

  // Handler for discarding all pending changes
  const discardNonDescriptionChanges = useCallback(() => {
    setTitleValue(ticket.title);
    setPendingChanges({});
    setPendingItilChanges({});
    setNotificationSuppression({
      suppressContactNotifications: false,
      suppressInternalNotifications: false,
    });
    setPendingBoardConfig(null);
    setPendingCategories(null);
    setPendingTeamId(null);
    setPendingTeamRemoval(false);
    setIsEditingTitle(false);
  }, [ticket.title]);

  const handleDiscardChanges = useCallback(() => {
    discardNonDescriptionChanges();
    if (isEditingDescription) {
      descriptionUploadSession.requestDiscard();
    }
  }, [descriptionUploadSession, discardNonDescriptionChanges, isEditingDescription]);

  // Handler for Cancel button click
  const handleCancelClick = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowCancelConfirm(true);
    }
  }, [hasUnsavedChanges]);

  // Handler for confirming cancel
  const handleCancelConfirm = useCallback(() => {
    handleDiscardChanges();
    setShowCancelConfirm(false);
  }, [handleDiscardChanges]);

  const handleCategoryChange = (categoryIds: string[]) => {
    if (categoryIds.length === 0 || categoryIds[0] === 'no-category' || categoryIds[0] === '') {
      handlePendingChange('category_id', null);
      handlePendingChange('subcategory_id', null);
      return;
    }

    const selectedCategoryId = categoryIds[0];
    const selectedCategory = effectiveCategories.find(c => c.category_id === selectedCategoryId);

    if (!selectedCategory) {
      handlePendingChange('category_id', selectedCategoryId);
      handlePendingChange('subcategory_id', null);
      return;
    }

    if (selectedCategory.parent_category) {
      handlePendingChange('category_id', selectedCategory.parent_category);
      handlePendingChange('subcategory_id', selectedCategoryId);
    } else {
      handlePendingChange('category_id', selectedCategoryId);
      handlePendingChange('subcategory_id', null);
    }
  };

  const getSelectedCategoryId = () => {
    const pendingSubcategory = pendingChanges.subcategory_id;
    const pendingCategory = pendingChanges.category_id;

    if (pendingSubcategory !== undefined) {
      return pendingSubcategory || '';
    }
    if (pendingCategory !== undefined) {
      return pendingCategory || '';
    }

    if (originalTicketValues.subcategory_id) {
      return originalTicketValues.subcategory_id;
    }
    return originalTicketValues.category_id || '';
  };

  // Handler for ITIL field changes (now uses pending changes)
  const handleLocalItilFieldChange = (field: 'itil_impact' | 'itil_urgency', value: number | null) => {
    handlePendingItilChange(field, value);
  };

  const customStyles = {
    trigger: "w-fit !inline-flex items-center justify-between rounded px-3 py-2 text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500",
    content: "bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 overflow-auto",
    item: "text-gray-900 cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-primary-100",
    itemIndicator: "absolute inset-y-0 right-0 flex items-center pr-4 text-primary-600",
  };

  // Calculate SLA status from ticket data
  const slaStatus = useMemo((): {
    status: SlaTimerStatus;
    responseRemainingMinutes?: number;
    resolutionRemainingMinutes?: number;
    isPaused: boolean;
  } | null => {
    if (hideSlaStatus) {
      return null;
    }
    if (!ticket.sla_policy_id) {
      return null;
    }

    const now = new Date();
    const isPaused = ticket.sla_paused_at !== null && ticket.sla_paused_at !== undefined;

    let responseRemainingMinutes: number | undefined;
    let resolutionRemainingMinutes: number | undefined;
    let status: SlaTimerStatus = 'on_track';

    // Calculate response remaining time
    if (!ticket.sla_response_at && ticket.sla_response_due_at) {
      const responseDue = new Date(ticket.sla_response_due_at);
      responseRemainingMinutes = Math.round((responseDue.getTime() - now.getTime()) / 60000);

      if (responseRemainingMinutes < 0) {
        status = 'response_breached';
      } else {
        const totalMs = responseDue.getTime() - new Date(ticket.sla_started_at || ticket.entered_at || '').getTime();
        const remainingMs = responseDue.getTime() - now.getTime();
        const elapsedPercent = totalMs > 0 ? ((totalMs - remainingMs) / totalMs) * 100 : 0;
        if (elapsedPercent >= 80) {
          status = 'at_risk';
        }
      }
    }

    // Calculate resolution remaining time
    if (!ticket.sla_resolution_at && ticket.sla_resolution_due_at) {
      const resolutionDue = new Date(ticket.sla_resolution_due_at);
      resolutionRemainingMinutes = Math.round((resolutionDue.getTime() - now.getTime()) / 60000);

      if (resolutionRemainingMinutes < 0 && status !== 'response_breached') {
        status = 'resolution_breached';
      } else if (status === 'on_track') {
        const totalMs = resolutionDue.getTime() - new Date(ticket.sla_started_at || ticket.entered_at || '').getTime();
        const remainingMs = resolutionDue.getTime() - now.getTime();
        const elapsedPercent = totalMs > 0 ? ((totalMs - remainingMs) / totalMs) * 100 : 0;
        if (elapsedPercent >= 80) {
          status = 'at_risk';
        }
      }
    }

    if (isPaused) {
      status = 'paused';
    }

    return {
      status,
      responseRemainingMinutes,
      resolutionRemainingMinutes,
      isPaused
    };
  }, [hideSlaStatus, ticket.sla_policy_id, ticket.sla_response_at, ticket.sla_response_due_at,
      ticket.sla_resolution_at, ticket.sla_resolution_due_at, ticket.sla_paused_at,
      ticket.sla_started_at, ticket.entered_at]);

  return (
    <ReflectionContainer id={id} label={`Info for ticket ${ticket.ticket_number}`}>
      <div className={`${styles['card']}`}>
        <div className="p-6">
          <div
            className={`mb-4 min-w-0 ${getFieldContainerClassName('title')}`}
            data-live-field="title"
            data-live-highlighted={isFieldHighlighted('title') ? 'true' : undefined}
            data-live-conflict={liveFieldConflicts.title ? 'true' : undefined}
          >
            <div className="flex items-center gap-2 min-w-0">
              {isEditingTitle ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Input
                    id={`${id}-title-input`}
                    type="text"
                    value={titleValue}
                    onChange={(e) => setTitleValue(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    onFocus={() => onLiveEditingFieldChange?.('title')}
                    onBlur={() => onLiveEditingFieldChange?.(null)}
                    autoFocus
                    disabled={isFieldFrozen('title')}
                    className="text-2xl font-bold flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    containerClassName="mb-0 flex-1"
                    style={{ minWidth: '300px', width: '100%' }}
                  />
                  <Button
                    id={`${id}-save-title-btn`}
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={handleTitleSubmit}
                    className="flex-shrink-0"
                    title={t('info.saveTitle', 'Save title')}
                    disabled={isFieldFrozen('title')}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button
                    id={`${id}-cancel-title-btn`}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleTitleCancel}
                    className="flex-shrink-0"
                    title={t('actions.cancel', 'Cancel')}
                    disabled={isFieldFrozen('title')}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <h1
                    ref={titleRef}
                    className="text-2xl font-bold break-words max-w-full min-w-0 flex-1"
                    style={{ overflowWrap: 'break-word', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                  >
                    {ticket.title}
                  </h1>
                  <button
                    onClick={() => setIsEditingTitle(true)}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-200 flex-shrink-0"
                    title={t('info.editTitle', 'Edit title')}
                    disabled={isFieldFrozen('title')}
                  >
                    <Pencil className="w-4 h-4 text-gray-500" />
                  </button>
                </>
              )}
            </div>
            {getEditingCaption('title') ? (
              <div
                className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                data-live-editing="true"
                data-testid={`${id}-title-editing-pill`}
              >
                {getEditingCaption('title')}
              </div>
            ) : null}
            {liveFieldConflicts.title ? (
              <FieldConflictBanner
                remoteAuthor={liveFieldConflicts.title.updatedBy.displayName}
                remoteAt={liveFieldConflicts.title.updatedAt}
                remoteValue={getConflictRemoteValue('title')}
                onKeepYours={() => handleKeepLiveConflict('title')}
                onTakeTheirs={() => handleTakeLiveConflict('title')}
              />
            ) : null}
          </div>
          {/* Unsaved changes alert banner */}
          {hasUnsavedChanges && (
            <Alert variant="warning" className="mb-4">
              <AlertDescription>
                {t('info.unsavedChanges', 'You have unsaved changes. Click "Save Changes" to apply them.')}
              </AlertDescription>
            </Alert>
          )}

          {/* Success alert after saving */}
          {saveSuccess && (
            <Alert variant="success" className="mb-4">
              <AlertDescription>
                {t('info.saveSuccess', 'Changes saved successfully!')}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Row 1: Status + Assigned To */}
            <div
              className={getFieldContainerClassName('status_id')}
              data-live-field="status_id"
              data-live-highlighted={isFieldHighlighted('status_id') ? 'true' : undefined}
              data-live-conflict={liveFieldConflicts.status_id ? 'true' : undefined}
              data-live-editing={isFieldRemotelyEdited('status_id') ? 'true' : undefined}
              {...createEditingFieldHandlers('status_id')}
            >
              <h5 className="font-bold mb-2">{t('fields.status', 'Status')}</h5>
              <div className={`transition-opacity ${isFieldRemotelyEdited('status_id') ? 'opacity-60' : ''}`}>
                <CustomSelect
                  value={pendingStatusValue}
                  options={boardScopedStatusOptions}
                  onValueChange={(value) => handlePendingChange('status_id', value)}
                  customStyles={customStyles}
                  className="!w-fit"
                  disabled={workflowLocked || !effectiveBoardId || isLoadingStatusOptions || isFieldFrozen('status_id')}
                />
              </div>
              {getEditingCaption('status_id') ? (
                <p className="mt-2 text-xs text-slate-500" data-testid={`${id}-status-editing-indicator`}>
                  {getEditingCaption('status_id')}
                </p>
              ) : null}
              {requiresDestinationStatusSelection && (
                <p className="mt-2 text-sm text-amber-700">
                  {t('info.selectStatusForNewBoard', 'Select a status for the new board before saving.')}
                </p>
              )}
              {liveFieldConflicts.status_id ? (
                <FieldConflictBanner
                  remoteAuthor={liveFieldConflicts.status_id.updatedBy.displayName}
                  remoteAt={liveFieldConflicts.status_id.updatedAt}
                  remoteValue={getConflictRemoteValue('status_id')}
                  onKeepYours={() => handleKeepLiveConflict('status_id')}
                  onTakeTheirs={() => handleTakeLiveConflict('status_id')}
                />
              ) : null}
            </div>
            <div
              className={getFieldContainerClassName('assigned_to')}
              data-live-field="assigned_to"
              data-live-highlighted={isFieldHighlighted('assigned_to') ? 'true' : undefined}
              data-live-conflict={liveFieldConflicts.assigned_to ? 'true' : undefined}
              data-live-editing={isFieldRemotelyEdited('assigned_to') ? 'true' : undefined}
              {...createEditingFieldHandlers('assigned_to')}
            >
              <h5 className="font-bold mb-2">{t('fields.assignedTo', 'Assigned To')}</h5>
              <div className={`flex items-center gap-1.5 transition-opacity ${isFieldRemotelyEdited('assigned_to') ? 'opacity-60' : ''}`}>
                <UserAndTeamPicker
                  value={pendingChanges.assigned_to ?? originalTicketValues.assigned_to ?? ''}
                  onValueChange={(value) => {
                    handlePendingChange('assigned_to', value);
                    // Clear team when switching to an individual agent
                    if (pendingTeamId) {
                      setPendingTeamId(null);
                    }
                    if (ticket.assigned_team_id) {
                      setPendingTeamRemoval(true);
                    }
                  }}
                  onTeamSelect={async (teamId) => {
                    // Defer team assignment to Save Changes (consistent with assigned_to)
                    setPendingTeamId(teamId);
                    // Also set assigned_to to the team lead as a pending change
                    const selectedTeam = teams.find(t => t.team_id === teamId);
                    const leadId = selectedTeam?.manager_id || selectedTeam?.members?.find(m => m.role === 'lead')?.user_id;
                    if (leadId) {
                      handlePendingChange('assigned_to', leadId);
                    }
                  }}
                  users={usersList}
                  teams={teams}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                  labelStyle="none"
                  buttonWidth="fit"
                  size="sm"
                  className="!w-fit"
                  placeholder={t('info.notAssigned', 'Not assigned')}
                  disabled={workflowLocked || isFieldFrozen('assigned_to')}
                />
                {(() => {
                  // Use pending team if set, otherwise saved team — but respect pending removal
                  const effectiveTeamId = pendingTeamId || (pendingTeamRemoval ? null : ticket.assigned_team_id);
                  if (!effectiveTeamId) return null;
                  const assignedTeam = teams.find(t => t.team_id === effectiveTeamId);
                  return assignedTeam ? (
                    <Tooltip content={assignedTeam.team_name}>
                      <Badge variant="info" size="sm" className="gap-1 cursor-help">
                        <TeamAvatar
                          teamId={assignedTeam.team_id}
                          teamName={assignedTeam.team_name}
                          avatarUrl={teamAvatarUrl}
                          size="xs"
                        />
                      </Badge>
                    </Tooltip>
                  ) : null;
                })()}
                {(additionalAgents?.length ?? 0) > 0 && (
                  <Tooltip content={
                    <div className="text-xs space-y-1.5">
                      <div className="font-medium text-gray-300 mb-1">{t('info.additionalAgentsTooltip', 'Additional Agents:')}</div>
                      {additionalAgents!.map((agent, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <UserAvatar
                            userId={agent.user_id}
                            userName={agent.name}
                            avatarUrl={additionalAgentAvatarUrls[agent.user_id] ?? null}
                            size="xs"
                          />
                          <span>{agent.name}</span>
                        </div>
                      ))}
                    </div>
                  }>
                    <Badge variant="info" size="sm" className="cursor-help">
                      +{additionalAgents!.length}
                    </Badge>
                  </Tooltip>
                )}
              </div>
              {getEditingCaption('assigned_to') ? (
                <p className="mt-2 text-xs text-slate-500">{getEditingCaption('assigned_to')}</p>
              ) : null}
              {liveFieldConflicts.assigned_to ? (
                <FieldConflictBanner
                  remoteAuthor={liveFieldConflicts.assigned_to.updatedBy.displayName}
                  remoteAt={liveFieldConflicts.assigned_to.updatedAt}
                  remoteValue={getConflictRemoteValue('assigned_to')}
                  onKeepYours={() => handleKeepLiveConflict('assigned_to')}
                  onTakeTheirs={() => handleTakeLiveConflict('assigned_to')}
                />
              ) : null}
            </div>

            {/* Row 2: Board + Category */}
            <div
              className={getFieldContainerClassName('board_id')}
              data-live-field="board_id"
              data-live-highlighted={isFieldHighlighted('board_id') ? 'true' : undefined}
              data-live-conflict={liveFieldConflicts.board_id ? 'true' : undefined}
              data-live-editing={isFieldRemotelyEdited('board_id') ? 'true' : undefined}
              {...createEditingFieldHandlers('board_id')}
            >
              <h5 className="font-bold mb-2">{t('info.board', 'Board')}</h5>
              <div className={`transition-opacity ${isFieldRemotelyEdited('board_id') ? 'opacity-60' : ''}`}>
                <CustomSelect
                  value={effectiveBoardId || ''}
                  options={boardOptions}
                  onValueChange={(value) => {
                    handlePendingChange('board_id', value);
                    if (value && value !== originalTicketValues.board_id) {
                      handlePendingChange('status_id', null);
                    } else {
                      handlePendingChange('status_id', originalTicketValues.status_id ?? null);
                    }
                    handlePendingChange('category_id', null);
                    handlePendingChange('subcategory_id', null);
                  }}
                  customStyles={customStyles}
                  className="!w-fit"
                  disabled={isFieldFrozen('board_id')}
                />
              </div>
              {getEditingCaption('board_id') ? (
                <p className="mt-2 text-xs text-slate-500">{getEditingCaption('board_id')}</p>
              ) : null}
              {liveFieldConflicts.board_id ? (
                <FieldConflictBanner
                  remoteAuthor={liveFieldConflicts.board_id.updatedBy.displayName}
                  remoteAt={liveFieldConflicts.board_id.updatedAt}
                  remoteValue={getConflictRemoteValue('board_id')}
                  onKeepYours={() => handleKeepLiveConflict('board_id')}
                  onTakeTheirs={() => handleTakeLiveConflict('board_id')}
                />
              ) : null}
            </div>
            {effectiveBoardConfig.category_type && (
              <div
                className={getFieldContainerClassName('category_id')}
                data-live-field="category_id"
                data-live-highlighted={isFieldHighlighted('category_id') ? 'true' : undefined}
                data-live-conflict={liveFieldConflicts.category_id ? 'true' : undefined}
                data-live-editing={isFieldRemotelyEdited('category_id') ? 'true' : undefined}
                {...createEditingFieldHandlers('category_id')}
              >
                <h5 className="font-bold mb-2">
                  {effectiveBoardConfig.category_type === 'custom'
                    ? t('fields.category', 'Category')
                    : t('info.itilCategory', 'ITIL Category')}
                </h5>
                <div className={`w-fit transition-opacity ${isFieldRemotelyEdited('category_id') ? 'opacity-60' : ''}`}>
                  {isLoadingBoardConfig ? (
                    <div className="h-10 w-48 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-md flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                      {t('info.loadingBoardConfig', 'Loading...')}
                    </div>
                  ) : (
                    <CategoryPicker
                      id={`${id}-category-picker`}
                      categories={effectiveCategories}
                      selectedCategories={[getSelectedCategoryId()]}
                      onSelect={handleCategoryChange}
                      placeholder={effectiveBoardConfig.category_type === 'custom'
                        ? t('quickAdd.selectCategory', 'Select category')
                        : t('quickAdd.selectItilCategory', 'Select ITIL category')}
                      onAddNew={() => setIsQuickAddCategoryOpen(true)}
                    />
                  )}
                </div>
                {getEditingCaption('category_id') ? (
                  <p className="mt-2 text-xs text-slate-500">{getEditingCaption('category_id')}</p>
                ) : null}
                {liveFieldConflicts.category_id ? (
                  <FieldConflictBanner
                    remoteAuthor={liveFieldConflicts.category_id.updatedBy.displayName}
                    remoteAt={liveFieldConflicts.category_id.updatedAt}
                    remoteValue={getConflictRemoteValue('category_id')}
                    onKeepYours={() => handleKeepLiveConflict('category_id')}
                    onTakeTheirs={() => handleTakeLiveConflict('category_id')}
                  />
                ) : null}
              </div>
            )}
            <QuickAddCategory
              isOpen={isQuickAddCategoryOpen}
              onClose={() => setIsQuickAddCategoryOpen(false)}
              onCategoryCreated={(newCategory) => {
                const mergeCategories = (existingCategories: ITicketCategory[]) => {
                  const existingIndex = existingCategories.findIndex((category) => category.category_id === newCategory.category_id);
                  if (existingIndex >= 0) {
                    const nextCategories = [...existingCategories];
                    nextCategories[existingIndex] = newCategory;
                    return nextCategories;
                  }
                  return [...existingCategories, newCategory];
                };

                if (pendingChanges.board_id) {
                  setPendingCategories((currentCategories) => mergeCategories(currentCategories || []));
                } else {
                  setCategories((currentCategories) => mergeCategories(currentCategories));
                }

                if (newCategory.parent_category) {
                  handlePendingChange('category_id', newCategory.parent_category);
                  handlePendingChange('subcategory_id', newCategory.category_id);
                } else {
                  handlePendingChange('category_id', newCategory.category_id);
                  handlePendingChange('subcategory_id', null);
                }

                setIsQuickAddCategoryOpen(false);
              }}
              preselectedBoardId={effectiveBoardId || undefined}
              categories={effectiveCategories}
            />

            {/* Row 3: Priority area (animated based on board type) */}
            <div className="col-span-2 transition-all duration-200 ease-in-out">
              {effectiveBoardConfig.priority_type === 'itil' ? (
                <div className="grid grid-cols-2 gap-4 transition-opacity duration-200 ease-in-out">
                  <div
                    className={getFieldContainerClassName('itil_impact')}
                    data-live-field="itil_impact"
                    data-live-highlighted={isFieldHighlighted('itil_impact') ? 'true' : undefined}
                    data-live-conflict={liveFieldConflicts.itil_impact ? 'true' : undefined}
                    data-live-editing={isFieldRemotelyEdited('itil_impact') ? 'true' : undefined}
                    {...createEditingFieldHandlers('itil_impact')}
                  >
                    <h5 className="font-bold mb-2">{t('itil.impact', 'Impact')}</h5>
                    <div className={`w-fit transition-opacity ${isFieldRemotelyEdited('itil_impact') ? 'opacity-60' : ''}`}>
                      <CustomSelect
                        options={[
                          { value: '1', label: '1 - High (Critical business function affected)' },
                          { value: '2', label: '2 - Medium-High (Important function affected)' },
                          { value: '3', label: '3 - Medium (Minor function affected)' },
                          { value: '4', label: '4 - Medium-Low (Minimal impact)' },
                          { value: '5', label: '5 - Low (No business impact)' }
                        ]}
                        value={effectiveItilImpact?.toString() || null}
                        onValueChange={(value) => handleLocalItilFieldChange('itil_impact', Number(value))}
                        placeholder={t('itil.selectImpact', 'Select Impact')}
                        disabled={isFieldFrozen('itil_impact')}
                      />
                    </div>
                    {getEditingCaption('itil_impact') ? (
                      <p className="mt-2 text-xs text-slate-500">{getEditingCaption('itil_impact')}</p>
                    ) : null}
                    {liveFieldConflicts.itil_impact ? (
                      <FieldConflictBanner
                        remoteAuthor={liveFieldConflicts.itil_impact.updatedBy.displayName}
                        remoteAt={liveFieldConflicts.itil_impact.updatedAt}
                        remoteValue={getConflictRemoteValue('itil_impact')}
                        onKeepYours={() => handleKeepLiveConflict('itil_impact')}
                        onTakeTheirs={() => handleTakeLiveConflict('itil_impact')}
                      />
                    ) : null}
                  </div>
                  <div
                    className={getFieldContainerClassName('itil_urgency')}
                    data-live-field="itil_urgency"
                    data-live-highlighted={isFieldHighlighted('itil_urgency') ? 'true' : undefined}
                    data-live-conflict={liveFieldConflicts.itil_urgency ? 'true' : undefined}
                    data-live-editing={isFieldRemotelyEdited('itil_urgency') ? 'true' : undefined}
                    {...createEditingFieldHandlers('itil_urgency')}
                  >
                    <h5 className="font-bold mb-2">{t('itil.urgency', 'Urgency')}</h5>
                    <div className={`w-fit transition-opacity ${isFieldRemotelyEdited('itil_urgency') ? 'opacity-60' : ''}`}>
                      <CustomSelect
                        options={[
                          { value: '1', label: '1 - High (Work cannot continue)' },
                          { value: '2', label: '2 - Medium-High (Work severely impaired)' },
                          { value: '3', label: '3 - Medium (Work continues with limitations)' },
                          { value: '4', label: '4 - Medium-Low (Minor inconvenience)' },
                          { value: '5', label: '5 - Low (Work continues normally)' }
                        ]}
                        value={effectiveItilUrgency?.toString() || null}
                        onValueChange={(value) => handleLocalItilFieldChange('itil_urgency', Number(value))}
                        placeholder={t('itil.selectUrgency', 'Select Urgency')}
                        disabled={isFieldFrozen('itil_urgency')}
                      />
                    </div>
                    {getEditingCaption('itil_urgency') ? (
                      <p className="mt-2 text-xs text-slate-500">{getEditingCaption('itil_urgency')}</p>
                    ) : null}
                    {liveFieldConflicts.itil_urgency ? (
                      <FieldConflictBanner
                        remoteAuthor={liveFieldConflicts.itil_urgency.updatedBy.displayName}
                        remoteAt={liveFieldConflicts.itil_urgency.updatedAt}
                        remoteValue={getConflictRemoteValue('itil_urgency')}
                        onKeepYours={() => handleKeepLiveConflict('itil_urgency')}
                        onTakeTheirs={() => handleTakeLiveConflict('itil_urgency')}
                      />
                    ) : null}
                  </div>
                  {/* Calculated ITIL Priority Badge */}
                  {calculatedItilPriority && (
                    <div className="col-span-2 flex items-center gap-2 mt-1">
                      <span className="text-sm text-gray-500">{t('info.calculatedPriority', 'Calculated Priority:')}</span>
                      <div
                        className="w-3 h-3 rounded-full border border-gray-300"
                        style={{ backgroundColor:
                          calculatedItilPriority === 1 ? '#DC2626' :
                          calculatedItilPriority === 2 ? '#EA580C' :
                          calculatedItilPriority === 3 ? '#F59E0B' :
                          calculatedItilPriority === 4 ? '#3B82F6' :
                          '#6B7280'
                        }}
                      />
                      <span className="text-sm font-medium">
                        {t(`itil.priorityLevels.${calculatedItilPriority}` as const, ItilLabels.priority[calculatedItilPriority])}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPriorityMatrix(!showPriorityMatrix)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        title={t('quickAdd.showPriorityMatrix', 'Show ITIL Priority Matrix')}
                      >
                        <HelpCircle className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {/* ITIL Priority Matrix - Show when help icon is clicked */}
                  {showPriorityMatrix && (
                    <div className="col-span-2 mt-3 p-4 bg-gray-50 border rounded-lg">
                      <h4 className="text-sm font-medium text-gray-800 mb-3">{t('itil.matrixTitle', 'ITIL Priority Matrix (Impact × Urgency)')}</h4>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr>
                              <th className="px-2 py-1 text-left text-gray-600 border-b"></th>
                              <th className="px-2 py-1 text-center text-gray-600 border-b whitespace-pre-line">{t('itil.urgencyAxis.1', 'High\nUrgency (1)')}</th>
                              <th className="px-2 py-1 text-center text-gray-600 border-b whitespace-pre-line">{t('itil.urgencyAxis.2', 'Medium-High\nUrgency (2)')}</th>
                              <th className="px-2 py-1 text-center text-gray-600 border-b whitespace-pre-line">{t('itil.urgencyAxis.3', 'Medium\nUrgency (3)')}</th>
                              <th className="px-2 py-1 text-center text-gray-600 border-b whitespace-pre-line">{t('itil.urgencyAxis.4', 'Medium-Low\nUrgency (4)')}</th>
                              <th className="px-2 py-1 text-center text-gray-600 border-b whitespace-pre-line">{t('itil.urgencyAxis.5', 'Low\nUrgency (5)')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.1', 'High Impact (1)')}</td>
                              <td className="px-2 py-1 text-center bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 font-semibold">{t('itil.priorityLevels.1', 'Critical (1)')}</td>
                              <td className="px-2 py-1 text-center bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                              <td className="px-2 py-1 text-center bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.2', 'Medium-High Impact (2)')}</td>
                              <td className="px-2 py-1 text-center bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                              <td className="px-2 py-1 text-center bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.3', 'Medium Impact (3)')}</td>
                              <td className="px-2 py-1 text-center bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                              <td className="px-2 py-1 text-center bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.4', 'Medium-Low Impact (4)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                              <td className="px-2 py-1 text-center bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                              <td className="px-2 py-1 text-center bg-gray-100 dark:bg-gray-800/30 text-gray-800 dark:text-gray-300 font-semibold">{t('itil.priorityLevels.5', 'Planning (5)')}</td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.5', 'Low Impact (5)')}</td>
                              <td className="px-2 py-1 text-center bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                              <td className="px-2 py-1 text-center bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                              <td className="px-2 py-1 text-center bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                              <td className="px-2 py-1 text-center bg-gray-100 dark:bg-gray-800/30 text-gray-800 dark:text-gray-300 font-semibold">{t('itil.priorityLevels.5', 'Planning (5)')}</td>
                              <td className="px-2 py-1 text-center bg-gray-100 dark:bg-gray-800/30 text-gray-800 dark:text-gray-300 font-semibold">{t('itil.priorityLevels.5', 'Planning (5)')}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-2 text-xs text-gray-600">
                        <p><strong>{t('itil.impact', 'Impact')}:</strong> {t('itil.impactHelp', 'How many users/business functions are affected?')}</p>
                        <p><strong>{t('itil.urgency', 'Urgency')}:</strong> {t('itil.urgencyHelp', 'How quickly does this need to be resolved?')}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className={`${getFieldContainerClassName('priority_id')} transition-opacity duration-200 ease-in-out`}
                  data-live-field="priority_id"
                  data-live-highlighted={isFieldHighlighted('priority_id') ? 'true' : undefined}
                  data-live-conflict={liveFieldConflicts.priority_id ? 'true' : undefined}
                  data-live-editing={isFieldRemotelyEdited('priority_id') ? 'true' : undefined}
                  {...createEditingFieldHandlers('priority_id')}
                >
                  <h5 className="font-bold mb-2">{t('fields.priority', 'Priority')}</h5>
                  <div className={`transition-opacity ${isFieldRemotelyEdited('priority_id') ? 'opacity-60' : ''}`}>
                    <PrioritySelect
                      value={pendingChanges.priority_id ?? originalTicketValues.priority_id ?? null}
                      options={priorityOptions}
                      onValueChange={(value) => handlePendingChange('priority_id', value)}
                      customStyles={customStyles}
                      className="!w-fit"
                      disabled={workflowLocked || isFieldFrozen('priority_id')}
                    />
                  </div>
                  {getEditingCaption('priority_id') ? (
                    <p className="mt-2 text-xs text-slate-500" data-testid={`${id}-priority-editing-indicator`}>
                      {getEditingCaption('priority_id')}
                    </p>
                  ) : null}
                  {liveFieldConflicts.priority_id ? (
                    <FieldConflictBanner
                      remoteAuthor={liveFieldConflicts.priority_id.updatedBy.displayName}
                      remoteAt={liveFieldConflicts.priority_id.updatedAt}
                      remoteValue={getConflictRemoteValue('priority_id')}
                      onKeepYours={() => handleKeepLiveConflict('priority_id')}
                      onTakeTheirs={() => handleTakeLiveConflict('priority_id')}
                    />
                  ) : null}
                </div>
              )}
            </div>

            {/* Row 4: Response State + Due Date (future SLA area) */}
            {responseStateTrackingEnabled && (
              <div
                className={getFieldContainerClassName('response_state')}
                data-live-field="response_state"
                data-live-highlighted={isFieldHighlighted('response_state') ? 'true' : undefined}
                data-live-conflict={liveFieldConflicts.response_state ? 'true' : undefined}
              >
                <ResponseStateDisplay
                  value={((pendingChanges.response_state ?? originalTicketValues.response_state) || null) as TicketResponseState}
                  onValueChange={(value) => handlePendingChange('response_state', value)}
                  editable={!isFieldFrozen('response_state')}
                />
                {liveFieldConflicts.response_state ? (
                  <FieldConflictBanner
                    remoteAuthor={liveFieldConflicts.response_state.updatedBy.displayName}
                    remoteAt={liveFieldConflicts.response_state.updatedAt}
                    remoteValue={getConflictRemoteValue('response_state')}
                    onKeepYours={() => handleKeepLiveConflict('response_state')}
                    onTakeTheirs={() => handleTakeLiveConflict('response_state')}
                  />
                ) : null}
              </div>
            )}
            <div
              className={getFieldContainerClassName('due_date')}
              data-live-field="due_date"
              data-live-highlighted={isFieldHighlighted('due_date') ? 'true' : undefined}
              data-live-conflict={liveFieldConflicts.due_date ? 'true' : undefined}
            >
              <h5 className="font-bold mb-2">{t('fields.dueDate', 'Due Date')}</h5>
              {(() => {
                const effectiveDueDate = pendingChanges.due_date !== undefined
                  ? (pendingChanges.due_date ? new Date(pendingChanges.due_date as string) : undefined)
                  : (originalTicketValues.due_date ? new Date(originalTicketValues.due_date as string) : undefined);
                const existingTime = effectiveDueDate ? format(effectiveDueDate, 'HH:mm') : undefined;
                const isMidnight = existingTime === '00:00';

                // Check if due date is SLA-driven (matches sla_resolution_due_at within 60s)
                const isSlaDriven = effectiveDueDate && ticket.sla_resolution_due_at &&
                  Math.abs(effectiveDueDate.getTime() - new Date(ticket.sla_resolution_due_at).getTime()) < 60000;
                const isDueDatePaused = isSlaDriven && slaStatus?.isPaused;

                let containerClass = '';
                if (isDueDatePaused) {
                  containerClass = '[&_button]:border-gray-300 [&_button]:text-gray-400 dark:[&_button]:text-gray-500 [&_button]:bg-gray-500/5';
                } else if (effectiveDueDate) {
                  const now = new Date();
                  const hoursUntilDue = (effectiveDueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
                  if (hoursUntilDue < 0) {
                    containerClass = '[&_button]:border-red-500 [&_button]:text-red-600 dark:[&_button]:text-red-400 [&_button]:bg-red-500/10';
                  } else if (hoursUntilDue <= 24) {
                    containerClass = '[&_button]:border-orange-500 [&_button]:text-orange-600 dark:[&_button]:text-orange-400 [&_button]:bg-orange-500/10';
                  }
                }

                const handleDateChange = (newDate: Date | undefined) => {
                  if (!newDate) {
                    handlePendingChange('due_date', null);
                    return;
                  }
                  if (effectiveDueDate && !isMidnight) {
                    newDate = setHours(newDate, effectiveDueDate.getHours());
                    newDate = setMinutes(newDate, effectiveDueDate.getMinutes());
                  } else {
                    newDate = setHours(newDate, 0);
                    newDate = setMinutes(newDate, 0);
                  }
                  handlePendingChange('due_date', newDate.toISOString());
                };

                const handleTimeChange = (newTime: string) => {
                  if (!effectiveDueDate) return;
                  const [hours, minutes] = newTime.split(':').map(Number);
                  let newDate = setHours(effectiveDueDate, hours);
                  newDate = setMinutes(newDate, minutes);
                  handlePendingChange('due_date', newDate.toISOString());
                };

                return (
                  <>
                    <div className={`flex items-center gap-2 w-fit ${containerClass}`}>
                      <div className="w-fit">
                        <DatePicker
                          id={`${id}-due-date-picker`}
                          value={effectiveDueDate}
                          onChange={handleDateChange}
                          placeholder={t('quickAdd.selectDate', 'Select date')}
                          label={t('fields.dueDate', 'Due Date')}
                          disabled={isFieldFrozen('due_date')}
                        />
                      </div>
                      <div className="w-fit">
                        <TimePicker
                          id={`${id}-due-time-picker`}
                          value={effectiveDueDate && !isMidnight ? existingTime : undefined}
                          onChange={handleTimeChange}
                          placeholder={t('quickAdd.timePlaceholder', 'Time')}
                          disabled={!effectiveDueDate || isFieldFrozen('due_date')}
                        />
                      </div>
                      {effectiveDueDate && (
                        <Button
                          id={`${id}-clear-due-date`}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePendingChange('due_date', null)}
                          className="text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-text-600))] px-2"
                          title={t('info.clearDueDate', 'Clear due date')}
                          disabled={isFieldFrozen('due_date')}
                        >
                          ✕
                        </Button>
                      )}
                      {isDueDatePaused && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 dark:text-gray-400 px-2 py-1 rounded-full">
                          <PauseCircle className="w-3 h-3" />
                          {t('info.paused', 'Paused')}
                        </span>
                      )}
                    </div>
                    {effectiveDueDate && isMidnight && (
                      <p className="text-xs text-gray-500 mt-1">{t('quickAdd.noTimeDefault', 'No time set - defaults to 12:00 AM')}</p>
                    )}
                  </>
                );
              })()}
              {liveFieldConflicts.due_date ? (
                <FieldConflictBanner
                  remoteAuthor={liveFieldConflicts.due_date.updatedBy.displayName}
                  remoteAt={liveFieldConflicts.due_date.updatedAt}
                  remoteValue={getConflictRemoteValue('due_date')}
                  onKeepYours={() => handleKeepLiveConflict('due_date')}
                  onTakeTheirs={() => handleTakeLiveConflict('due_date')}
                />
              ) : null}
            </div>

            {/* Row 5: SLA Status */}
            {slaStatus && (
              <div className="col-span-2">
                <h5 className="font-bold mb-2">{t('info.slaStatus', 'SLA Status')}</h5>
                <div className="flex items-center gap-3">
                  <SlaStatusBadge
                    status={slaStatus.status}
                    responseRemainingMinutes={slaStatus.responseRemainingMinutes}
                    resolutionRemainingMinutes={slaStatus.resolutionRemainingMinutes}
                    isPaused={slaStatus.isPaused}
                    size="md"
                    showIcon={true}
                  />
                  {ticket.sla_response_met === false && (
                    <span className="text-xs text-[rgb(var(--badge-error-text))] bg-[rgb(var(--badge-error-bg))] border border-[rgb(var(--badge-error-border))] px-2 py-1 rounded-full">
                      {t('info.responseSlaBreached', 'Response SLA breached')}
                    </span>
                  )}
                  {ticket.sla_resolution_met === false && (
                    <span className="text-xs text-[rgb(var(--badge-error-text))] bg-[rgb(var(--badge-error-bg))] border border-[rgb(var(--badge-error-border))] px-2 py-1 rounded-full">
                      {t('info.resolutionSlaBreached', 'Resolution SLA breached')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Row 6: Tags */}
            <div className="col-span-2">
              <h5 className="font-bold mb-2">{t('settings.display.columns.tags', 'Tags')}</h5>
              {onTagsChange && ticket.ticket_id ? (
                <TagManager
                  entityId={ticket.ticket_id}
                  entityType="ticket"
                  initialTags={tags}
                  onTagsChange={onTagsChange}
                  useInlineInput={isInDrawer}
                />
              ) : (
                <p className="text-sm text-gray-500">{t('info.tagsCannotBeManaged', 'Tags cannot be managed')}</p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-semibold">{t('fields.description', 'Description')}</h2>
              {!isEditingDescription && (
                <button
                  onClick={() => {
                    // Store original content before entering edit mode
                    originalDescriptionRef.current = descriptionContent;
                    setHasDescriptionContentChanged(false);
                    setIsEditingDescription(true);
                  }}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-200"
                  title={t('info.editDescription', 'Edit description')}
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </div>

            {isEditingDescription ? (
              <div className="min-w-0 w-full">
                <div className="min-w-0 w-full">
                  <TextEditor
                    id={`${id}-description-editor`}
                    initialContent={descriptionContent}
                    searchMentions={searchUsersForMentions}
                    uploadFile={descriptionUploadSession.uploadFile}
                    onContentChange={(content) => {
                      setDescriptionContent(content);
                      // Track if content has changed from original
                      if (originalDescriptionRef.current) {
                        const originalStr = serializeTicketRichTextContent(originalDescriptionRef.current);
                        const currentStr = serializeTicketRichTextContent(content);
                        setHasDescriptionContentChanged(originalStr !== currentStr);
                      }
                    }}
                  />
                </div>
                <div className="flex justify-end space-x-2 mt-2">
                  <Button
                    id={`${id}-save-description-btn`}
                    onClick={async () => {
                      try {
                        const result = await persistDescriptionChanges();
                        if (result === true) {
                          finalizeSavedDescription();
                        }
                      } catch (error) {
                        console.error('Failed to save description:', error);
                      }
                    }}
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? t('info.saving', 'Saving...')
                      : t('actions.save', 'Save')}
                  </Button>
                  <Button
                    id={`${id}-cancel-description-btn`}
                    disabled={isSubmitting}
                    variant="outline"
                    onClick={descriptionUploadSession.requestDiscard}
                  >
                    {t('actions.cancel', 'Cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose max-w-none break-words overflow-hidden min-w-0" style={{overflowWrap: 'break-word', wordBreak: 'break-word'}}>
                {(() => {
                  // Get description from ticket attributes
                  const descriptionText = ticket.attributes?.description as string;

                  if (!descriptionText) return t('info.noDescription', 'No description found.');

                  return <RichTextViewer content={descriptionText} className="break-words max-w-full min-w-0" />;
                })()}
              </div>
            )}
          </div>

          {/* Save Changes Button - matching contracts behavior */}
          <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-gray-200">
            {renderProjectTaskActions?.({ ticket, additionalAgents })}
            {ticket.ticket_id && onOpenEmailNotificationLogs ? (
              <Tooltip content={t('info.openEmailNotificationLogs', 'View email notification logs')}>
                <Button
                  id={`${id}-open-email-notification-logs`}
                  type="button"
                  variant="soft"
                  size="icon"
                  onClick={onOpenEmailNotificationLogs}
                  aria-label={t('info.openEmailNotificationLogs', 'View email notification logs')}
                  className="h-9 w-9"
                >
                  <Mail className="w-4 h-4" />
                </Button>
              </Tooltip>
            ) : null}
            {ticket.ticket_id && onOpenActivityLog ? (
              <Tooltip content={t('info.openActivityLog', 'View activity log')}>
                <Button
                  id="ticket-activity-log-button"
                  type="button"
                  variant="soft"
                  size="icon"
                  onClick={onOpenActivityLog}
                  aria-label={t('info.openActivityLog', 'View activity log')}
                  className="h-9 w-9"
                >
                  <History className="w-4 h-4" />
                </Button>
              </Tooltip>
            ) : null}
            {hasUnsavedChanges ? (
              <TicketNotificationSuppressionControl
                idPrefix={`${id}-save-bar`}
                value={notificationSuppression}
                onChange={setNotificationSuppression}
                disabled={isSaving}
                className="min-w-[260px]"
              />
            ) : null}
            <div className="flex-1" />
            <Button
              id={`${id}-cancel-btn`}
              type="button"
              variant="outline"
              onClick={handleCancelClick}
              disabled={isSaving}
            >
              {t('actions.cancel', 'Cancel')}
            </Button>
            <Button
              id={`${id}-save-changes-btn`}
              type="button"
              onClick={handleSaveChanges}
              disabled={isSaving || requiresDestinationStatusSelection || hasActiveLiveConflict}
            >
              <span className={hasUnsavedChanges ? 'font-bold' : ''}>
                {isSaving
                  ? t('info.saving', 'Saving...')
                  : hasUnsavedChanges
                    ? `${t('info.saveChanges', 'Save Changes')} *`
                    : t('info.saveChanges', 'Save Changes')}
              </span>
              {!isSaving && <Save className="ml-2 h-4 w-4" />}
            </Button>
          </div>
          {hasActiveLiveConflict ? (
            <p className="mt-2 text-sm text-amber-700">
              {t('info.resolveLiveConflict', 'Resolve live update conflicts before saving your changes.')}
            </p>
          ) : null}

          {/* Cancel confirmation dialog */}
          <ConfirmationDialog
            id={`${id}-cancel-confirm-dialog`}
            isOpen={showCancelConfirm}
            onClose={() => setShowCancelConfirm(false)}
            onConfirm={handleCancelConfirm}
            title={t('info.discardChangesTitle', 'Discard Changes')}
            message={t('info.discardChangesMessage', 'You have unsaved changes. Are you sure you want to discard them?')}
            confirmLabel={t('info.discard', 'Discard')}
            cancelLabel={t('info.keepEditing', 'Keep Editing')}
          />
          <ConfirmationDialog
            id={`${id}-description-clipboard-draft-cancel-dialog`}
            isOpen={descriptionUploadSession.showDraftCancelDialog}
            onClose={() => descriptionUploadSession.setShowDraftCancelDialog(false)}
            onConfirm={descriptionUploadSession.deleteTrackedDraftClipboardImages}
            onCancel={descriptionUploadSession.keepDraftClipboardImages}
            title={t('conversation.clipboardDraftCancelTitle', 'Pasted Images Detected')}
            message={t('info.clipboardDraftMessage', 'This description includes pasted images that were already uploaded as ticket documents. Keep them, or delete them permanently?')}
            confirmLabel={t('conversation.deleteUploadedImages', 'Delete Images')}
            thirdButtonLabel={t('conversation.keepUploadedImages', 'Keep Images')}
            cancelLabel={t('quickAdd.continueEditing', 'Continue Editing')}
            isConfirming={descriptionUploadSession.isDeletingDraftImages}
          />
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default TicketInfo;
