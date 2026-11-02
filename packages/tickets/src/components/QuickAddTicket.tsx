// @ts-nocheck
// TODO: Priority index signature issue
'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { HelpCircle, Paperclip, X } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Link2, Copy, LayoutTemplate } from 'lucide-react';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import Spinner from '@alga-psa/ui/components/Spinner';
import { addTicket, updateTicket } from '../actions/ticketActions';
import { addTicketResource } from '../actions/ticketResourceActions';
import { getCurrentUser } from '@alga-psa/user-composition/actions/userQueryActions';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions/avatarActions';
import { searchUsersForMentions } from '@alga-psa/user-composition/actions/searchUsersForMentions';
import { getContactsByClient, getClientLocations } from '../actions/clientLookupActions';
import { getTicketFormData } from '../actions/ticketFormActions';
import { getTicketDuplicateSource } from '../actions/ticketActions';
import { getTicketTemplateForCreate, listTicketTemplatesForCreate } from '../actions/ticketTemplateActions';
import type { TicketDuplicateSource } from '../lib/ticketDuplicate';
import { getTicketCategoriesByBoard, BoardCategoryData } from '../actions/ticketCategoryActions';
import type { TicketTemplateForCreate, TicketTemplateOption } from '@alga-psa/types';
import { IUser, IBoard, ITicketStatus, IPriority, IStandardPriority, IClient, IClientLocation, IContact, ITicket, ITicketCategory } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { CategoryPicker } from './CategoryPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import { Input } from '@alga-psa/ui/components/Input';
import { TextEditor } from '@alga-psa/ui/editor';
import { toast } from 'react-hot-toast';
import { useAutomationIdAndRegister } from '@alga-psa/ui/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { DialogComponent, FormFieldComponent, ButtonComponent, ContainerComponent } from '@alga-psa/ui/ui-reflection/types';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useRegisterUIComponent } from '@alga-psa/ui/ui-reflection/useRegisterUIComponent';
import { calculateItilPriority, ItilLabels } from '@alga-psa/tickets/lib/itilUtils';
import { QuickAddTagPicker } from '@alga-psa/tags/components/QuickAddTagPicker';
import type { PendingTag } from '@alga-psa/types';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { createTagsForEntity } from '@alga-psa/tags/actions/tagActions';
import { getTeams } from '@alga-psa/teams/actions/team-actions/teamActions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions/team-actions/avatarActions';
import { isTeamActionError } from '@alga-psa/teams/actions/team-actions/teamActionErrors';
import { assignTeamToTicket } from '../actions/teamAssignmentActions';
import type { ITeam } from '@alga-psa/types';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuickAddClient } from '@alga-psa/ui/context';
import QuickAddCategory from './QuickAddCategory';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { nextTemplateTitle, renderTitleTemplate, titleHasTokens, toCalendarDate, type TitleTokenContext } from '../lib/ticketTitleTokens';
import {
  extractTicketRichTextPlainText,
  parseTicketRichTextContent,
  serializeTicketRichTextContent,
} from '../lib/ticketRichText';
import { resolveDocumentViewUrl } from '../lib/documentViewUrl';
import { removeTicketRichTextImageUrls, replaceTicketRichTextImageUrls } from '../lib/ticketRichTextImages';
import { useQuickAddRichTextUploadSession } from './useQuickAddRichTextUploadSession';
import { getTicketStatuses } from '@alga-psa/reference-data/actions/status-actions/statusActions';
import { useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import { toCalendarDisplayDate } from '@alga-psa/core';

export interface QuickAddAssetPickerProps {
  id: string;
  clientId: string;
  value: string[];
  onChange: (assetIds: string[]) => void;
  label: string;
  disabled?: boolean;
}

/** Renders a <form> normally, or a plain <div> when embedded to avoid nested form tags. */
function FormOrDiv({ isEmbedded, onSubmit, children }: { isEmbedded: boolean; onSubmit: (e: React.FormEvent) => void; children: React.ReactNode }) {
  if (isEmbedded) {
    return <div className="space-y-4">{children}</div>;
  }
  return <form onSubmit={onSubmit} className="space-y-4" noValidate>{children}</form>;
}

const isReturnedActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

function toPrefilledDueDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  return toCalendarDisplayDate(value) ?? undefined;
}

// Helper function to format location display
const formatLocationDisplay = (location: IClientLocation, unnamedFallback = 'Unnamed Location'): string => {
  const parts: string[] = [];
  
  if (location.location_name) {
    parts.push(location.location_name);
  }
  
  if (location.address_line1) {
    parts.push(location.address_line1);
  }
  
  if (location.city && location.state_province) {
    parts.push(`${location.city}, ${location.state_province}`);
  } else if (location.city) {
    parts.push(location.city);
  } else if (location.state_province) {
    parts.push(location.state_province);
  }
  
  if (location.postal_code) {
    parts.push(location.postal_code);
  }
  
  return parts.join(' - ') || unnamedFallback;
};

const getDefaultStatus = (availableStatuses: ITicketStatus[]): ITicketStatus | null => {
  const statusesWithDefault = availableStatuses as Array<ITicketStatus & { is_default?: boolean }>;
  const openStatuses = statusesWithDefault.filter(status => !status.is_closed);

  return (
    openStatuses.find(status => status.is_default) ||
    openStatuses[0] ||
    statusesWithDefault.find(status => status.is_default) ||
    statusesWithDefault[0] ||
    null
  );
};

const getDefaultPriorityId = (availablePriorities: IPriority[], priorityType?: 'custom' | 'itil'): string => {
  if (!availablePriorities.length) return '';

  if (priorityType === 'itil') {
    const itilPriorities = availablePriorities.filter(priority => priority.is_from_itil_standard);
    const mediumItilPriority = itilPriorities.find(priority => priority.itil_priority_level === 3);
    return mediumItilPriority?.priority_id || itilPriorities[0]?.priority_id || availablePriorities[0]?.priority_id || '';
  }

  const customPriorities = availablePriorities.filter(priority => !priority.is_from_itil_standard);
  return customPriorities[0]?.priority_id || availablePriorities[0]?.priority_id || '';
};

const getBoardDefaultPriorityId = (board: IBoard | undefined, availablePriorities: IPriority[]): string => {
  if (!availablePriorities.length) return '';

  const boardDefault = board?.default_priority_id || '';
  if (boardDefault) {
    const match = availablePriorities.find(p => p.priority_id === boardDefault);
    if (match) {
      // Guard against misconfiguration: only use ITIL defaults for ITIL boards and vice versa.
      const priorityType = board?.priority_type || 'custom';
      if (priorityType === 'itil' && match.is_from_itil_standard) return boardDefault;
      if (priorityType !== 'itil' && !match.is_from_itil_standard) return boardDefault;
    }
  }

  return getDefaultPriorityId(availablePriorities, board?.priority_type);
};

interface QuickAddTicketProps {
  id?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded: (ticket: ITicket) => void;
  /**
   * Optional handler for the "Create + View Ticket" action. When provided, this component
   * delegates the post-create navigation entirely to the host instead of calling
   * onTicketAdded + onOpenChange + its own router.push. The intercepting-route modal
   * (CreateTicketRouteClient) supplies this so closing the modal and navigating to the new
   * ticket happen as ONE navigation — otherwise the modal's close handler (router.back) races
   * the router.push to the ticket, and one aborts the other (the user is stranded on the
   * tickets list, or the dialog is left stuck over the detail page).
   */
  onViewCreatedTicket?: (ticket: ITicket) => void;
  prefilledClient?: {
    id: string;
    name: string;
  };
  prefilledContact?: {
    id: string;
    name: string;
  };
  prefilledDescription?: string;
  prefilledTitle?: string;
  prefilledAssignedTo?: string;
  prefilledDueDate?: Date | string | null;
  prefilledAdditionalAgents?: { user_id: string; name?: string }[];
  isEmbedded?: boolean;
  assetId?: string;
  /** Optional asset display name; rendered in a banner so the operator sees which asset will be linked. */
  assetName?: string;
  renderBeforeFooter?: () => React.ReactNode;
  isAlgaDeskMode?: boolean;
  /**
   * Duplicate mode: prefill the form from this ticket. The form loads the source
   * itself (getTicketDuplicateSource); the client stays editable (do not combine
   * with prefilledClient).
   */
  duplicateFromTicketId?: string;
  /**
   * Template mode: prefill the form from this ticket template (`/msp/create-ticket?template=<id>`).
   * Ignored when `duplicateFromTicketId` is set; a request names a duplicate source or a template, never both.
   */
  templateId?: string;
  /**
   * Multi-select of the chosen client's assets. The assets package owns the picker and the tickets package
   * cannot import it, so the composition layer injects it; without it the Assets section is not shown
   * beyond the asset the form was opened from.
   */
  renderAssetPicker?: (props: QuickAddAssetPickerProps) => React.ReactNode;
}

export function QuickAddTicket({
  id = 'ticket-quick-add',
  open,
  onOpenChange,
  onTicketAdded,
  onViewCreatedTicket,
  prefilledClient,
  prefilledContact,
  prefilledDescription,
  prefilledTitle,
  prefilledAssignedTo,
  prefilledDueDate,
  prefilledAdditionalAgents,
  isEmbedded = false,
  assetId,
  assetName,
  renderBeforeFooter,
  isAlgaDeskMode = false,
  duplicateFromTicketId,
  templateId,
  renderAssetPicker,
}: QuickAddTicketProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { renderQuickAddClient, renderQuickAddContact } = useQuickAddClient();
  const { t } = useTranslation('features/tickets');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // True once a "Create + View" navigation has been handed to onViewCreatedTicket. The
  // navigation is a slow RSC fetch during which this modal is still mounted; keep the actions
  // disabled so the operator can't fire a second create before the page swaps.
  const [isNavigatingToTicket, setIsNavigatingToTicket] = useState(false);
  // Latched once addTicket has returned a ticket, until the form is reset or the dialog closes
  // or reopens. The ref is the synchronous re-entry guard for handleCreateTicket (state would
  // lag a second trigger in the same tick); the state mirrors it for rendering.
  const [ticketCreated, setTicketCreated] = useState(false);
  const ticketCreatedRef = useRef(false);
  const createInFlightRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [title, setTitle] = useState(prefilledTitle || '');
  const [descriptionContent, setDescriptionContent] = useState(() =>
    parseTicketRichTextContent(prefilledDescription || '')
  );
  const [descriptionEditorInstanceKey, setDescriptionEditorInstanceKey] = useState(0);
  const [assignedTo, setAssignedTo] = useState(prefilledAssignedTo || '');
  const [assignedTeamId, setAssignedTeamId] = useState<string | null>(null);
  const [tempAdditionalAgents, setTempAdditionalAgents] = useState<
    { user_id: string; first_name: string; last_name: string; temp_id: string }[]
  >(() => {
    if (prefilledAdditionalAgents?.length) {
      return prefilledAdditionalAgents.map(agent => {
        const nameParts = (agent.name || '').split(' ');
        return {
          user_id: agent.user_id,
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          temp_id: `temp-${Date.now()}-${agent.user_id}`,
        };
      });
    }
    return [];
  });
  const [teamAvatarUrl, setTeamAvatarUrl] = useState<string | null>(null);
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [boardId, setBoardId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [clientId, setClientId] = useState(prefilledClient?.id || '');
  const [contactId, setContactId] = useState(prefilledContact?.id || null);
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [selectedClientType, setSelectedClientType] = useState<'company' | 'individual' | null>(null);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [boardConfig, setBoardConfig] = useState<BoardCategoryData['boardConfig']>({
    category_type: 'custom',
    priority_type: 'custom',
    display_itil_impact: false,
    display_itil_urgency: false,
  });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [statuses, setStatuses] = useState<ITicketStatus[]>([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState(false);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [locations, setLocations] = useState<IClientLocation[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [isPrefilledClient, setIsPrefilledClient] = useState(false);
  const [isQuickAddClientOpen, setIsQuickAddClientOpen] = useState(false);
  const [isQuickAddCategoryOpen, setIsQuickAddCategoryOpen] = useState(false);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
  const [quickAddBoardFilterState, setQuickAddBoardFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);
  const [dueDate, setDueDate] = useState<Date | undefined>(() => {
    return toPrefilledDueDate(prefilledDueDate);
  });
  // ITIL-specific state
  const [itilImpact, setItilImpact] = useState<number | undefined>(undefined);
  const [itilUrgency, setItilUrgency] = useState<number | undefined>(undefined);
  const [showPriorityMatrix, setShowPriorityMatrix] = useState(false);
  // Duplicate mode: the loaded source ticket, a load failure, and the checklist opt-out.
  const [duplicateSource, setDuplicateSource] = useState<TicketDuplicateSource | null>(null);
  const [duplicateLoadError, setDuplicateLoadError] = useState<string | null>(null);
  const [copyChecklist, setCopyChecklist] = useState(true);
  // Template mode: the applied template, the picker options, a load failure, and the checklist opt-out.
  const [templateSource, setTemplateSource] = useState<TicketTemplateForCreate | null>(null);
  const [templateOptions, setTemplateOptions] = useState<TicketTemplateOption[]>([]);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [copyTemplateChecklist, setCopyTemplateChecklist] = useState(true);
  // The title last produced from the template's tokens. While the title still equals it (or is empty) the
  // operator has not edited it, so a client or contact change re-renders it (R8).
  const lastRenderedTitleRef = useRef<string | null>(null);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const effectiveAssetId = isAlgaDeskMode ? undefined : assetId;
  // Create extras (all optional; assets and watchers go in the same addTicket call, attachments after).
  const [extraAssetIds, setExtraAssetIds] = useState<string[]>([]);
  const [watcherIds, setWatcherIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Calculate ITIL priority when impact and urgency are set
  const calculatedItilPriority = useMemo(() => {
    if (itilImpact && itilUrgency) {
      try {
        return calculateItilPriority(itilImpact, itilUrgency);
      } catch {
        return null;
      }
    }
    return null;
  }, [itilImpact, itilUrgency]);

  // ITIL options for selects
  const itilImpactOptions = useMemo<SelectOption[]>(() => [
    { value: '1', label: t('itil.impactLevels.1', '1 - High (Critical business function affected)') },
    { value: '2', label: t('itil.impactLevels.2', '2 - Medium-High (Important function affected)') },
    { value: '3', label: t('itil.impactLevels.3', '3 - Medium (Minor function affected)') },
    { value: '4', label: t('itil.impactLevels.4', '4 - Medium-Low (Minimal impact)') },
    { value: '5', label: t('itil.impactLevels.5', '5 - Low (No business impact)') }
  ], [t]);

  const itilUrgencyOptions = useMemo<SelectOption[]>(() => [
    { value: '1', label: t('itil.urgencyLevels.1', '1 - High (Work cannot continue)') },
    { value: '2', label: t('itil.urgencyLevels.2', '2 - Medium-High (Work severely impaired)') },
    { value: '3', label: t('itil.urgencyLevels.3', '3 - Medium (Work continues with limitations)') },
    { value: '4', label: t('itil.urgencyLevels.4', '4 - Medium-Low (Minor inconvenience)') },
    { value: '5', label: t('itil.urgencyLevels.5', '5 - Low (Work continues normally)') }
  ], [t]);

  // NOTE: Categories are now unified - no need for separate ITIL category filtering

  // NOTE: ITIL category selection is now handled by the unified CategoryPicker
  // Categories are managed through the selectedCategories state and regular category handling


  const { automationIdProps: dialogProps, updateMetadata } = useAutomationIdAndRegister<DialogComponent>({
    id: 'quick-add-ticket-dialog',
    type: 'dialog',
    label: t('quickAdd.dialogLabel', 'Quick Add Ticket Dialog'),
    helperText: "",
    title: t('quickAdd.dialogTitle', 'Quick Add Ticket'),
  });

  const descriptionUploadSession = useQuickAddRichTextUploadSession({
    componentLabel: 'QuickAddTicket',
    onDiscard: () => {
      resetForm();
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false);
      setIsLoading(false);
      resetForm();
      return;
    }

    resetForm();
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Duplicate mode loads the source alongside the form data. No client argument is
        // passed to getTicketFormData, so the client stays editable.
        // Template mode (preload) and the picker's options load alongside; a user who cannot read
        // templates simply gets no picker.
        const preloadTemplateId = duplicateFromTicketId ? undefined : templateId;
        const [formData, duplicateResult, templateResult, optionsResult] = await Promise.all([
          getTicketFormData(prefilledClient?.id),
          duplicateFromTicketId ? getTicketDuplicateSource(duplicateFromTicketId) : Promise.resolve(null),
          preloadTemplateId ? getTicketTemplateForCreate(preloadTemplateId) : Promise.resolve(null),
          duplicateFromTicketId ? Promise.resolve(null) : listTicketTemplatesForCreate().catch(() => null),
        ]);
        setTemplateOptions(Array.isArray(optionsResult) ? optionsResult : []);

        setUsers(formData.users);
        setBoards(formData.boards);
        setPriorities(formData.priorities);
        setClients(formData.clients);

        const availableBoards = formData.boards || [];
        const availablePriorities = formData.priorities || [];

        if (formData.selectedClient) {
          setIsPrefilledClient(true);
          setClientId(formData.selectedClient.client_id);
          setSelectedClientType(formData.selectedClient.client_type as 'company' | 'individual');
          if (formData.contacts) {
            setContacts(formData.contacts);
          }
        } else {
          // No prefilled client, ensure isPrefilledClient is false
          setIsPrefilledClient(false);
        }

        if (prefilledContact) {
          setContactId(prefilledContact.id);
        }

        if (prefilledDescription) {
          setDescriptionContent(parseTicketRichTextContent(prefilledDescription));
          setDescriptionEditorInstanceKey((current) => current + 1);
        }
        if (prefilledTitle) {
          setTitle(prefilledTitle);
        }
        if (prefilledAssignedTo) {
          setAssignedTo(prefilledAssignedTo);
        }
        if (prefilledDueDate) {
          setDueDate(toPrefilledDueDate(prefilledDueDate));
        }

        if (duplicateResult) {
          if (isReturnedActionError(duplicateResult)) {
            setDuplicateLoadError(getErrorMessage(duplicateResult));
          } else {
            applyDuplicateSource(duplicateResult);
          }
        }

        if (templateResult) {
          if (isReturnedActionError(templateResult)) {
            setTemplateLoadError(getErrorMessage(templateResult));
          } else {
            applyTemplateSource(templateResult);
          }
        }
      } catch (error) {
        console.error('Error fetching form data:', error);
        if (templateId && !duplicateFromTicketId) {
          setTemplateLoadError(
            t('quickAdd.templateLoadFailed', 'The template could not be loaded. Please try again.')
          );
        }
        if (duplicateFromTicketId) {
          setDuplicateLoadError(
            t('quickAdd.duplicateLoadFailed', 'The ticket to duplicate could not be loaded. Please try again.')
          );
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [open, prefilledClient?.id, duplicateFromTicketId, templateId]);

  useEffect(() => {
    if (!open) {
      setTeams([]);
      return;
    }
    const fetchTeamsData = async () => {
      try {
        const fetchedTeams = await getTeams();
        if (isTeamActionError(fetchedTeams)) {
          console.warn('Cannot load teams for quick-add ticket assignment:', fetchedTeams);
          return;
        }
        setTeams(fetchedTeams);
      } catch (err) {
        console.error('Error fetching teams:', err);
      }
    };
    fetchTeamsData();
  }, [open]);

  useEffect(() => {
    if (!open || isLoading) return;

    const animationFrame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [open, isLoading]);

  useEffect(() => {
    const fetchClientData = async () => {
      if (!clientId) {
        // Clear both contacts and locations when no client is selected
        setContacts([]);
        setLocations([]);
        return;
      }

      console.log('Fetching client data for:', { clientId, isPrefilledClient });

      try {
        // Fetch both locations and contacts (when needed) in parallel
        const promises: Promise<any>[] = [
          getClientLocations(clientId)
        ];
        
        // Only fetch contacts if not prefilled (contacts are already loaded for prefilled clients)
        if (!isPrefilledClient) {
          promises.push(getContactsByClient(clientId, 'all'));
        }
        
        const results = await Promise.all(promises);
        const locationsData = results[0];
        console.log('Fetched locations:', locationsData);
        setLocations(locationsData || []);
        
        if (!isPrefilledClient) {
          const contactsData = results[1];
          console.log('Fetched contacts:', contactsData);
          setContacts(contactsData || []);
        }
      } catch (error) {
        console.error('Error fetching client data:', error);
        setLocations([]);
        // Only clear contacts if we were trying to fetch them
        if (!isPrefilledClient) {
          setContacts([]);
        }
      }
    };

    fetchClientData();
  }, [clientId, isPrefilledClient]);

  useEffect(() => {
    let isMounted = true;

    const fetchStatusesForBoard = async () => {
      if (!boardId) {
        if (isMounted) {
          setStatuses([]);
          setStatusId('');
          setIsLoadingStatuses(false);
        }
        return;
      }

      if (isMounted) {
        setIsLoadingStatuses(true);
      }
      try {
        const boardStatuses = await getTicketStatuses(boardId);
        if (isMounted) {
          setStatuses(boardStatuses);
        }
      } catch (error) {
        console.error('Error fetching board statuses:', error);
        if (isMounted) {
          setStatuses([]);
          setStatusId('');
        }
      } finally {
        if (isMounted) {
          setIsLoadingStatuses(false);
        }
      }
    };

    fetchStatusesForBoard();

    return () => {
      isMounted = false;
    };
  }, [boardId]);

  useEffect(() => {
    if (!boardId || isLoadingStatuses) {
      return;
    }

    const currentStatusIsValid = statuses.some((status) => status.status_id === statusId);
    if (currentStatusIsValid) {
      return;
    }

    const nextStatusId = getDefaultStatus(statuses)?.status_id || '';
    if (nextStatusId !== statusId) {
      setStatusId(nextStatusId);
    }
  }, [boardId, statuses, statusId, isLoadingStatuses]);

  useEffect(() => {
    const fetchCategories = async () => {
      if (boardId) {
        try {
          const data = await getTicketCategoriesByBoard(boardId);
          if (isReturnedActionError(data)) {
            setError(getErrorMessage(data));
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
          if (data && data.categories && Array.isArray(data.categories)) {
            setCategories(data.categories);
            setBoardConfig(data.boardConfig);
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
        } catch (error) {
          console.error('Error fetching categories:', error);
          setCategories([]);
          setBoardConfig({
            category_type: 'custom',
            priority_type: 'custom',
            display_itil_impact: false,
            display_itil_urgency: false,
          });
        }
      } else {
        setCategories([]);
        setSelectedCategories([]);
      }
    };

    if (boardId) {
      fetchCategories();
    }
  }, [boardId]);

  useEffect(() => {
    if (!updateMetadata) return;

    updateMetadata({
      helperText: error || undefined,
      open: open,
    });
  }, [error, open]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setError(null);
    }
  };

  const handleClientChange = async (newClientId: string | null) => {
    // A prefilled client is a default, not a lock — the picker stays enabled,
    // so swallowing the choice just snapped the dialog back to the client it
    // was opened with. Honour it and let the effect load that client's
    // contacts, which the prefilled branch skips.
    if (isPrefilledClient) {
      if (newClientId === clientId) return;
      setIsPrefilledClient(false);
    }

    setClientId(newClientId || '');
    // Assets are picked from the client's own list, so the previous client's selection no longer applies.
    setExtraAssetIds([]);
    setContactId(null);
    // The location belongs to the client that was selected before.
    setLocationId(null);
    clearErrorIfSubmitted();

    if (newClientId !== null) {
      const selectedClient = clients.find(client => client.client_id === newClientId);

      if (selectedClient?.client_type === 'company') {
        setSelectedClientType('company');
      } else if (selectedClient?.client_type === 'individual') {
        setSelectedClientType('individual');
      } else {
        setSelectedClientType(null);
      }
    } else {
      setSelectedClientType(null);
    }
  };

  const handleBoardChange = (newBoardId: string) => {
    setBoardId(newBoardId);
    setStatuses([]);
    setStatusId('');
    setSelectedCategories([]);
    setShowPriorityMatrix(false);
    setPriorityId('');
    setItilImpact(undefined);
    setItilUrgency(undefined);
    clearErrorIfSubmitted();

    const selectedBoard = boards.find(b => b.board_id === newBoardId);

    // Pre-fill assigned agent and team from board's defaults if not already set
    if (!assignedTo && newBoardId) {
      if (selectedBoard?.default_assigned_team_id) {
        // Resolve current team lead dynamically
        const defaultTeam = teams.find(t => t.team_id === selectedBoard.default_assigned_team_id);
        if (defaultTeam?.manager_id) {
          setAssignedTo(defaultTeam.manager_id);
        } else if (selectedBoard.default_assigned_to) {
          setAssignedTo(selectedBoard.default_assigned_to);
        }
      } else if (selectedBoard?.default_assigned_to) {
        setAssignedTo(selectedBoard.default_assigned_to);
      }
    }
    if (!assignedTeamId && selectedBoard?.default_assigned_team_id) {
      setAssignedTeamId(selectedBoard.default_assigned_team_id);
    }

    const priorityType = selectedBoard?.priority_type || 'custom';
    const defaultPriorityId = getBoardDefaultPriorityId(selectedBoard, priorities);

    if (defaultPriorityId) {
      setPriorityId(defaultPriorityId);
    }

    if (priorityType === 'itil') {
      // Default ITIL tickets to medium impact/urgency for quick entry.
      setItilImpact(3);
      setItilUrgency(3);
    }
  };

  // Fetch team avatar URL when assigned team changes
  useEffect(() => {
    if (!assignedTeamId) {
      setTeamAvatarUrl(null);
      return;
    }
    const team = teams.find(t => t.team_id === assignedTeamId);
    if (!team?.tenant) return;

    getTeamAvatarUrlsBatchAction([assignedTeamId], team.tenant)
      .then(result => {
        if (result instanceof Map) {
          setTeamAvatarUrl(result.get(assignedTeamId) ?? null);
        } else {
          setTeamAvatarUrl((result as Record<string, string | null>)[assignedTeamId] ?? null);
        }
      })
      .catch(() => setTeamAvatarUrl(null));
  }, [assignedTeamId, teams]);

  // Applies a duplicate draft by setting form state directly. It must NOT go through
  // handleBoardChange / handleClientChange: those reset the copied priority, category and
  // assignees (and apply board-default assignees). Setting boardId directly lets the status
  // effect pick the board's default status and the categories effect load the picker
  // without clearing the selection. Status and due date are deliberately not copied.
  function applyDuplicateSource(source: TicketDuplicateSource) {
    setDuplicateSource(source);
    setCopyChecklist(true);
    applyCopiedTicketFields({
      title: source.title,
      description: source.description || '',
      board_id: source.board_id,
      priority_id: source.priority_id,
      itil_impact: source.itil_impact,
      itil_urgency: source.itil_urgency,
      category_id: source.category_id,
      subcategory_id: source.subcategory_id,
      tags: source.tags.map((tag) => ({
        tag_id: tag.tag_id,
        tag_text: tag.tag_text,
        background_color: tag.background_color,
        text_color: tag.text_color,
        isNew: false,
      })),
    });
    setClientId(source.client.id);
    setSelectedClientType((source.client.type as 'company' | 'individual' | null) ?? null);
    setContactId(source.contact?.id ?? null);
    setLocationId(source.location_id ?? null);
    setAssignedTo(source.assigned_to ?? '');
    setAssignedTeamId(source.assigned_team_id ?? null);
    setTempAdditionalAgents(
      source.additional_agents.map((agent) => ({
        user_id: agent.user_id,
        first_name: agent.first_name || '',
        last_name: agent.last_name || '',
        temp_id: `temp-${Date.now()}-${agent.user_id}`,
      }))
    );
  }

  // The ticket fields a duplicate and a template have in common. Same rule as above: state is set
  // directly, never through handleBoardChange, so the copied priority / category survive and the
  // status effect picks the board's default status. A template never touches client, contact,
  // location or assignees.
  function applyCopiedTicketFields(fields: {
    title: string;
    description: string;
    board_id: string | null;
    priority_id: string | null;
    itil_impact: number | null;
    itil_urgency: number | null;
    category_id: string | null;
    subcategory_id: string | null;
    tags: PendingTag[];
  }) {
    setTitle(fields.title);
    setDescriptionContent(parseTicketRichTextContent(fields.description));
    setDescriptionEditorInstanceKey((current) => current + 1);
    setBoardId(fields.board_id ?? '');
    setPriorityId(fields.priority_id ?? '');
    setItilImpact(fields.itil_impact ?? undefined);
    setItilUrgency(fields.itil_urgency ?? undefined);
    setSelectedCategories(
      [fields.subcategory_id ?? fields.category_id].filter((categoryId): categoryId is string => Boolean(categoryId))
    );
    setPendingTags(fields.tags);
  }

  // Tokens are filled from the client, contact and due date picked so far; a missing one renders empty.
  // The due date is a calendar date taken from the picked Date's local parts (not toISOString).
  function templateTitleContext(): TitleTokenContext {
    const clientName = clients.find((candidate) => candidate.client_id === clientId)?.client_name ?? null;
    const contactName = contacts.find((candidate) => candidate.contact_name_id === contactId)?.full_name ?? null;
    return { clientName, contactName, dueDate: dueDate ? toCalendarDate(dueDate) : null };
  }

  function renderTemplateTitle(rawTitle: string): string {
    return renderTitleTemplate(rawTitle, templateTitleContext());
  }

  function applyTemplateSource(source: TicketTemplateForCreate) {
    setTemplateSource(source);
    setCopyTemplateChecklist(true);
    setTemplateLoadError(null);
    const renderedTitle = renderTemplateTitle(source.title);
    lastRenderedTitleRef.current = titleHasTokens(source.title) ? renderedTitle : null;
    applyCopiedTicketFields({
      title: renderedTitle,
      description: source.description,
      board_id: source.board_id,
      priority_id: source.priority_id,
      itil_impact: source.itil_impact,
      itil_urgency: source.itil_urgency,
      category_id: source.category_id,
      subcategory_id: source.subcategory_id,
      tags: source.tags.map((tag) => ({
        tag_id: tag.tag_id ?? undefined,
        tag_text: tag.tag_text,
        background_color: tag.background_color ?? undefined,
        text_color: tag.text_color ?? undefined,
        isNew: tag.is_new,
      })),
    });
  }

  async function loadAndApplyTemplate(nextTemplateId: string) {
    try {
      const result = await getTicketTemplateForCreate(nextTemplateId);
      if (isReturnedActionError(result)) {
        setTemplateLoadError(getErrorMessage(result));
      } else {
        applyTemplateSource(result);
      }
    } catch (loadError) {
      console.error('Error loading ticket template:', loadError);
      setTemplateLoadError(t('quickAdd.templateLoadFailed', 'The template could not be loaded. Please try again.'));
    }
  }

  // The picker. Applying a template replaces the draft, so a dirty draft asks first. "None" only
  // detaches the template: fields the operator already has stay.
  function handleTemplateSelect(nextTemplateId: string) {
    if (!nextTemplateId) {
      setTemplateSource(null);
      setTemplateLoadError(null);
      return;
    }
    if (nextTemplateId === templateSource?.template_id) return;
    if (hasUnsavedDraftText) {
      setPendingTemplateId(nextTemplateId);
      return;
    }
    void loadAndApplyTemplate(nextTemplateId);
  }

  function resetForm() {
    setTitle(prefilledTitle || '');
    setDescriptionContent(parseTicketRichTextContent(prefilledDescription || ''));
    setDescriptionEditorInstanceKey((current) => current + 1);
    setAssignedTo(prefilledAssignedTo || '');
    setAssignedTeamId(null);
    setTempAdditionalAgents(
      prefilledAdditionalAgents?.length
        ? prefilledAdditionalAgents.map(agent => {
            const nameParts = (agent.name || '').split(' ');
            return {
              user_id: agent.user_id,
              first_name: nameParts[0] || '',
              last_name: nameParts.slice(1).join(' ') || '',
              temp_id: `temp-${Date.now()}-${agent.user_id}`,
            };
          })
        : []
    );
    setTeamAvatarUrl(null);
    setBoardId('');
    setStatuses([]);
    setStatusId('');
    setPriorityId('');
    setClientId(prefilledClient?.id || '');
    setContactId(prefilledContact?.id || null);
    setLocationId(null);
    setLocations([]);
    setContacts([]);
    // Reset isPrefilledClient - it will be set to true again if there's a prefilled client
    setIsPrefilledClient(false);
    if (prefilledClient?.id) {
      const client = clients.find(c => c.client_id === prefilledClient.id);
      setSelectedClientType(client?.client_type as 'company' | 'individual' || null);
    } else {
      setSelectedClientType(null);
    }
    setSelectedCategories([]);
    // Reset ITIL fields
    setItilImpact(undefined);
    setItilUrgency(undefined);
    setShowPriorityMatrix(false);
    setPendingTags([]);
    setDuplicateSource(null);
    setDuplicateLoadError(null);
    setCopyChecklist(true);
    setTemplateSource(null);
    setTemplateLoadError(null);
    setCopyTemplateChecklist(true);
    setPendingTemplateId(null);
    setExtraAssetIds([]);
    setWatcherIds([]);
    setAttachments([]);
    setIsQuickAddContactOpen(false);
    if (prefilledDueDate) {
      setDueDate(toPrefilledDueDate(prefilledDueDate));
    } else {
      setDueDate(undefined);
    }
    setError(null);
    setHasAttemptedSubmit(false);
    ticketCreatedRef.current = false;
    setTicketCreated(false);
    descriptionUploadSession.resetDraftTracking();
  }

  const handleClose = () => {
    descriptionUploadSession.requestDiscard();
  };

  // Typed-but-unsent text: a title or description that differs from what the dialog
  // opened with. Staged clipboard images already have their own discard confirmation
  // in requestDiscard, so they are not counted here (that would ask twice).
  // In duplicate mode the dialog opens with the source ticket's title and description
  // (applyDuplicateSource), so those are the baseline rather than the prefilled props.
  //
  // Never dirty while a create is in flight or done: the ticket is saved (or being saved), and a
  // reload from addTicket's revalidatePath would otherwise raise a "Leave site?" prompt, whose
  // Cancel leaves a filled form that can be submitted again. Derived from state rather than a
  // ref: setIsSubmitting(true) runs in the submit event and commits before addTicket's network
  // round trip can finish, and isSubmitting stays true until the same batch that has
  // ticketCreated/isNavigatingToTicket set, so there is no window where all three are false
  // for a saved ticket. A failed create clears isSubmitting without latching, so the guard returns.
  useEffect(() => {
    if (!templateSource) return;
    const next = nextTemplateTitle(templateSource.title, templateTitleContext(), title, lastRenderedTitleRef.current);
    if (next === null) return;
    lastRenderedTitleRef.current = next;
    if (next !== title) setTitle(next);
    // Only a client, contact or due date change re-renders; title edits must not loop back through here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, contactId, dueDate, templateSource, clients, contacts]);

  // A template prefill is a baseline too: an untouched template-filled draft is not dirty.
  const draftBaselineTitle = duplicateSource ? duplicateSource.title : templateSource ? lastRenderedTitleRef.current ?? templateSource.title : prefilledTitle;
  const draftBaselineDescription = duplicateSource
    ? duplicateSource.description
    : templateSource ? templateSource.description : prefilledDescription;
  const hasUnsavedDraftText =
    open &&
    !isSubmitting &&
    !isNavigatingToTicket &&
    !ticketCreated &&
    descriptionUploadSession.stagedClipboardImages.length === 0 &&
    (title.trim() !== (draftBaselineTitle || '').trim() ||
      extractTicketRichTextPlainText(descriptionContent).trim() !==
        extractTicketRichTextPlainText(draftBaselineDescription || '').trim());


  // Chosen-but-unsent extras count as unsaved work for the leave guard, with the same saved/in-flight exemptions.
  const hasUnsavedExtras =
    open &&
    !isSubmitting &&
    !isNavigatingToTicket &&
    !ticketCreated &&
    (attachments.length > 0 || watcherIds.length > 0 || extraAssetIds.length > 0);

  const validateForm = () => {
    const validationErrors: string[] = [];
    if (!title.trim()) validationErrors.push(t('create.errors.titleRequired', 'Title is required'));
    if (!boardId) validationErrors.push(t('validation.quickAdd.boardRequired', 'Please select a board'));
    if (!statusId) validationErrors.push(t('validation.quickAdd.statusRequired', 'Please select a status'));

    // Validate priority based on board type
    if (boardConfig.priority_type === 'custom') {
      // Custom priority boards require priority_id
      if (!priorityId) {
        validationErrors.push(t('validation.quickAdd.priorityRequired', 'Please select a priority'));
      }
    } else if (boardConfig.priority_type === 'itil') {
      // ITIL priority boards require impact and urgency
      if (!itilImpact) validationErrors.push(t('validation.quickAdd.impactRequired', 'Please select an impact'));
      if (!itilUrgency) validationErrors.push(t('validation.quickAdd.urgencyRequired', 'Please select an urgency'));
    } else {
      // Default to custom behavior if priority_type is undefined
      if (!priorityId) {
        validationErrors.push(t('validation.quickAdd.priorityRequired', 'Please select a priority'));
      }
    }

    if (!clientId) validationErrors.push(t('validation.quickAdd.clientRequired', 'Please select a client'));
    return validationErrors;
  };

  const finalizeDescriptionForCreatedTicket = async (newTicket: ITicket) => {
    if (!newTicket.ticket_id || descriptionUploadSession.stagedClipboardImages.length === 0) {
      return serializeTicketRichTextContent(descriptionContent);
    }

    const effectiveUserId =
      session?.user?.id || (await getCurrentUser())?.user_id;

    if (!effectiveUserId) {
      throw new Error(t('quickAdd.clipboardUploadSessionRequired', 'User session is required for clipboard image upload.'));
    }

    const replacementUrls = new Map<string, string>();
    const { uploadDocument } = await import('@alga-psa/documents/actions/documentActions');

    for (const stagedImage of descriptionUploadSession.stagedClipboardImages) {
      const fileFormData = new FormData();
      fileFormData.append('file', stagedImage.file);

      const uploadResult = await uploadDocument(fileFormData, {
        userId: effectiveUserId,
        ticketId: newTicket.ticket_id,
      });

      if (isActionPermissionError(uploadResult)) {
        throw new Error(uploadResult.permissionError || t('quickAdd.clipboardUploadFailed', 'Clipboard image upload failed.'));
      }

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || t('quickAdd.clipboardUploadFailed', 'Clipboard image upload failed.'));
      }

      const uploadedDocument = uploadResult.document;
      const documentUrl = resolveDocumentViewUrl(uploadedDocument);

      replacementUrls.set(stagedImage.url, documentUrl);
    }

    const finalizedDescriptionContent = replaceTicketRichTextImageUrls(
      descriptionContent,
      replacementUrls
    );
    const serializedDescription = serializeTicketRichTextContent(finalizedDescriptionContent);

    const updateResult = await updateTicket(newTicket.ticket_id, {
      attributes: {
        ...(newTicket.attributes || {}),
        description: serializedDescription,
      },
    });
    if (isReturnedActionError(updateResult)) {
      throw new Error(getErrorMessage(updateResult));
    }

    return serializedDescription;
  };

  // Returns the names of files that failed to upload. Never throws.
  const uploadAttachmentsForTicket = async (ticketId: string): Promise<string[]> => {
    const failed: string[] = [];
    let effectiveUserId: string | undefined;
    try {
      effectiveUserId = session?.user?.id || (await getCurrentUser())?.user_id;
    } catch (userError) {
      console.error('Failed to resolve user for attachment upload:', userError);
    }
    if (!effectiveUserId) {
      return attachments.map((file) => file.name);
    }
    const { uploadDocument } = await import('@alga-psa/documents/actions/documentActions');
    for (const file of attachments) {
      try {
        const fileFormData = new FormData();
        fileFormData.append('file', file);
        const uploadResult = await uploadDocument(fileFormData, { userId: effectiveUserId, ticketId });
        if (isActionPermissionError(uploadResult) || !uploadResult.success) {
          failed.push(file.name);
        }
      } catch (uploadError) {
        console.error(`Failed to upload attachment ${file.name}:`, uploadError);
        failed.push(file.name);
      }
    }
    return failed;
  };

  const handleCreateTicket = async ({ openAfterCreate = false }: { openAfterCreate?: boolean } = {}) => {
    // Refs, not button state: two quick triggers (click + Cmd+Enter) must not both reach addTicket.
    if (createInFlightRef.current || ticketCreatedRef.current) {
      return;
    }
    setHasAttemptedSubmit(true);

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join('\n'));
      return;
    }

    createInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('title', title);
      const stagedClipboardImageUrls = new Set(
        descriptionUploadSession.stagedClipboardImages.map((image) => image.url)
      );
      const descriptionForCreate = descriptionUploadSession.stagedClipboardImages.length > 0
        ? removeTicketRichTextImageUrls(descriptionContent, stagedClipboardImageUrls)
        : descriptionContent;

      formData.append('description', serializeTicketRichTextContent(descriptionForCreate));
      formData.append('assigned_to', assignedTo);
      formData.append('board_id', boardId);
      formData.append('status_id', statusId);

      // Always append priority_id - for ITIL boards, the backend will map
      // the calculated priority to the correct ITIL standard priority record
      formData.append('priority_id', priorityId);

      formData.append('client_id', clientId);

      if (selectedClientType === 'company' && contactId) {
        formData.append('contact_name_id', contactId);
      }

      if (locationId) {
        formData.append('location_id', locationId);
      }

      if (selectedCategories.length > 0) {
        const category = categories.find(c => c.category_id === selectedCategories[0]);
        if (category) {
          if (category.parent_category) {
            // This is a subcategory - set parent as category and this as subcategory
            formData.append('category_id', category.parent_category);
            formData.append('subcategory_id', category.category_id);
          } else {
            // This is a parent category - only set category_id
            formData.append('category_id', category.category_id);
          }
        }
      }

      if (effectiveAssetId) {
        formData.append('asset_id', effectiveAssetId);
      }
      // Extra linked assets and watchers travel in the same addTicket call, so the server
      // writes them in the ticket's transaction. Omitted when empty so the legacy payload is unchanged.
      const additionalAssetIds = extraAssetIds.filter((assetIdValue) => assetIdValue !== effectiveAssetId);
      if (additionalAssetIds.length > 0) {
        formData.append('asset_ids', JSON.stringify(additionalAssetIds));
      }
      if (watcherIds.length > 0) {
        formData.append('watcher_ids', JSON.stringify(watcherIds));
      }

      // Add ITIL Impact and Urgency for calculation (if provided)
      if (itilImpact) {
        formData.append('itil_impact', itilImpact.toString());
      }
      if (itilUrgency) {
        formData.append('itil_urgency', itilUrgency.toString());
      }

      // Add due date if provided (the field carries the time of day with it)
      if (dueDate) {
        formData.append('due_date', dueDate.toISOString());
      }

      // Duplicate mode: name the source; the server copies the checklist and custom
      // fields from it inside addTicket's transaction. Status is never sent from the source.
      if (duplicateSource) {
        formData.append('duplicate_of_ticket_id', duplicateSource.ticket_id);
        formData.append('duplicate_copy_checklist', String(copyChecklist));
      }

      // Template mode: name the template; the server copies the checklist and custom fields inside
      // addTicket's transaction. Only the id and the checklist opt-out are sent, never template content.
      if (templateSource && !duplicateSource) {
        formData.append('ticket_template_id', templateSource.template_id);
        formData.append('template_copy_checklist', String(copyTemplateChecklist));
      }

      // ITIL categories now use the unified category system
      // The selected ITIL category ID is already in selectedCategories/categoryId

      const newTicket = await addTicket(formData);
      if (isReturnedActionError(newTicket)) {
        setError(getErrorMessage(newTicket));
        return;
      }
      if (!newTicket) {
        throw new Error(t('errors.createTicketFailed', 'Failed to create ticket. Please try again.'));
      }
      ticketCreatedRef.current = true;
      setTicketCreated(true);

      let finalizedDescription = serializeTicketRichTextContent(descriptionForCreate);
      try {
        finalizedDescription = await finalizeDescriptionForCreatedTicket(newTicket);
      } catch (descriptionFinalizeError) {
        console.error('Failed to finalize quick add description:', descriptionFinalizeError);
        toast.error(t('quickAdd.clipboardUploadPartialFailure', 'Ticket created, but pasted images could not be attached to the description.'));
      }

      // Attachments are uploaded after the ticket exists, outside its transaction, one file at a time.
      // A failed file never affects the ticket or the other files; the user is told which ones failed.
      if (attachments.length > 0 && newTicket.ticket_id) {
        const failedFiles = await uploadAttachmentsForTicket(newTicket.ticket_id);
        if (failedFiles.length > 0) {
          toast.error(t('quickAdd.attachmentsPartialFailure', {
            defaultValue: 'Ticket created, but these files could not be attached: {{files}}. Add them from the ticket.',
            files: failedFiles.join(', '),
          }), { duration: 10000 });
        }
      }

      // Assign team if selected
      if (assignedTeamId && newTicket.ticket_id) {
        try {
          const assignResult = await assignTeamToTicket(newTicket.ticket_id, assignedTeamId);
          if (isReturnedActionError(assignResult)) {
            throw new Error(getErrorMessage(assignResult));
          }
        } catch (teamError) {
          console.error('Failed to assign team:', teamError);
          toast.error(teamError instanceof Error
            ? teamError.message
            : t('quickAdd.teamAssignmentPartialFailure', 'Ticket created but team assignment failed'));
        }
      }

      // Add additional agents as ticket resources
      if (tempAdditionalAgents.length > 0 && newTicket.ticket_id) {
        for (const agent of tempAdditionalAgents) {
          try {
            const resourceResult = await addTicketResource(newTicket.ticket_id, agent.user_id, 'support');
            if (isReturnedActionError(resourceResult)) {
              throw new Error(getErrorMessage(resourceResult));
            }
          } catch (agentError) {
            console.error(`Failed to add additional agent ${agent.user_id}:`, agentError);
          }
        }
      }

      // Create tags for the new ticket
      let createdTags: typeof newTicket.tags = [];
      if (pendingTags.length > 0 && newTicket.ticket_id) {
        try {
          createdTags = await createTagsForEntity(newTicket.ticket_id, 'ticket', pendingTags);
          if (createdTags.length < pendingTags.length) {
            const failedCount = pendingTags.length - createdTags.length;
            toast.error(t('quickAdd.tagCreatePartialFailure', {
              count: failedCount,
              defaultValue: failedCount === 1 ? '{{count}} tag could not be created' : '{{count}} tags could not be created',
            }));
          }
        } catch (tagError) {
          console.error("Error creating ticket tags:", tagError);
          toast.error(t('quickAdd.tagCreatePartialFailure', {
            count: pendingTags.length,
            defaultValue: pendingTags.length === 1 ? '{{count}} tag could not be created' : '{{count}} tags could not be created',
          }));
        }
      }

      const finalTicket = {
        ...newTicket,
        attributes: {
          ...(newTicket.attributes || {}),
          description: finalizedDescription,
        },
        tags: createdTags,
      };

      // "Create + View": when the host owns navigation (the intercepting-route modal does),
      // hand the new ticket to it and stop. Doing onTicketAdded + onOpenChange + router.push
      // here as well would fire a second, competing navigation that aborts the first — that
      // race is what stranded the user on the tickets list (or left this dialog stuck over the
      // detail page). The host performs exactly one navigation, which also unmounts this modal.
      if (openAfterCreate && newTicket.ticket_id && onViewCreatedTicket) {
        setIsNavigatingToTicket(true);
        onViewCreatedTicket(finalTicket);
        return;
      }

      // Pass ticket with tags to callback
      await onTicketAdded(finalTicket);
      resetForm();

      onOpenChange(false);

      if (openAfterCreate && newTicket.ticket_id) {
        router.push(`/msp/tickets/${newTicket.ticket_id}`);
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
      setError(t('errors.createTicketFailed', 'Failed to create ticket. Please try again.'));
    } finally {
      createInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await handleCreateTicket();
  };

  useDialogSubmitShortcut(
    () => { void handleCreateTicket(); },
    { active: open && !isEmbedded, enabled: !isSubmitting && !isLoading && !ticketCreated && !isNavigatingToTicket },
  );

  const filteredClients = clients.filter(client => {
    if (clientFilterState === 'all') return true;
    if (clientFilterState === 'active') return !client.is_inactive;
    if (clientFilterState === 'inactive') return client.is_inactive;
    return true;
  });

  const hasRequiredFieldErrors = !title.trim() || !boardId || !statusId ||
    (boardConfig.priority_type === 'custom' && !priorityId) ||
    (boardConfig.priority_type === 'itil' && (!itilImpact || !itilUrgency)) ||
    (boardConfig.priority_type === undefined && !priorityId) ||
    !clientId;


  const memoizedStatusOptions = useMemo(
    () =>
      statuses.map((status): SelectOption => ({
        value: status.status_id,
        label: status.name ?? ""
      })),
    [statuses]
  );

  const memoizedPriorityOptions = useMemo(
    () => {
      // A board only offers the priority family its priority_type declares
      // (same rule as getBoardDefaultPriorityId and the category picker), so a
      // custom board never lists leftover ITIL priorities.
      const selectedBoard = boards.find(board => board.board_id === boardId);
      const priorityType = selectedBoard?.priority_type ?? boardConfig.priority_type ?? 'custom';

      return priorities
        .filter(priority => priorityType === 'itil'
          ? Boolean(priority.is_from_itil_standard)
          : !priority.is_from_itil_standard)
        .map((priority): SelectOption => ({
          value: priority.priority_id,
          label: (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full border border-gray-300"
                style={{ backgroundColor: priority.color || '#6B7280' }}
              />
              <span>{priority.priority_name}</span>
            </div>
          )
        }));
    },
    [priorities, boards, boardId, boardConfig.priority_type]
  );

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id={`${id}-cancel-btn`}
        type="button"
        variant="outline"
        onClick={handleClose}
      >
        {t('actions.cancel', 'Cancel')}
      </Button>
      <Button
        id={`${id}-create-open-btn`}
        type="button"
        variant="secondary"
        disabled={isSubmitting || isNavigatingToTicket || ticketCreated}
        onClick={() => {
          void handleCreateTicket({ openAfterCreate: true });
        }}
        className={hasRequiredFieldErrors ? 'opacity-50' : ''}
      >
        {isNavigatingToTicket
          ? t('quickAdd.openingTicket', 'Opening ticket…')
          : isSubmitting
            ? t('quickAdd.submitting', 'Adding...')
            : t('quickAdd.createAndView', 'Create + View Ticket')}
      </Button>
      <Button
        id={`${id}-submit-btn`}
        type="button"
        variant="default"
        disabled={isSubmitting || isNavigatingToTicket || ticketCreated}
        onClick={() => { void handleCreateTicket(); }}
        className={hasRequiredFieldErrors ? 'opacity-50' : ''}
      >
        {isSubmitting
          ? t('quickAdd.submitting', 'Adding...')
          : t('actions.create', 'Create')}
      </Button>
    </div>
  );

  return (
    <div>
      <Dialog
        id={`${id}-dialog`}
        isOpen={open}
        onClose={handleClose}
        hasUnsavedChanges={hasUnsavedDraftText || hasUnsavedExtras}
        className="w-full max-w-2xl max-h-[90vh]"
        title={duplicateSource
          ? t('quickAdd.duplicateDialogTitle', {
              defaultValue: 'Duplicate ticket #{{number}}',
              number: duplicateSource.ticket_number,
            })
          : t('quickAdd.dialogTitle', 'Quick Add Ticket')}
        footer={footer}
      >
        <DialogContent>
          {isLoading ? (
            <div className="p-6">
              <Spinner size="sm" />
            </div>
          ) : (
            <>
                  {hasAttemptedSubmit && error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>
                    <p className="font-medium mb-2">{t('quickAdd.requiredFieldsHeading', 'Please fill in the required fields:')}</p>
                    <ul className="list-disc list-inside space-y-1">
                      {error.split('\n').map((err, index) => (
                        <li key={index}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {duplicateLoadError && (
                <Alert variant="destructive" className="mb-4" data-testid="quick-add-ticket-duplicate-error">
                  <AlertDescription>{duplicateLoadError}</AlertDescription>
                </Alert>
              )}

              {duplicateSource && (
                <div className="mb-4 flex pb-2">
                  <Badge
                    variant="secondary"
                    className="inline-flex items-center gap-1.5 rounded-full"
                    data-testid="quick-add-ticket-duplicate-pill"
                  >
                    <Copy className="h-3 w-3" />
                    {t('quickAdd.duplicatingPill', {
                      defaultValue: 'Duplicating #{{number}}',
                      number: duplicateSource.ticket_number,
                    })}
                  </Badge>
                </div>
              )}

              {templateLoadError && (
                <Alert variant="destructive" className="mb-4" data-testid="quick-add-ticket-template-error">
                  <AlertDescription>{templateLoadError}</AlertDescription>
                </Alert>
              )}

              {templateSource && (
                <div className="mb-4 flex pb-2">
                  <Badge
                    variant="secondary"
                    className="inline-flex items-center gap-1.5 rounded-full"
                    data-testid="quick-add-ticket-template-pill"
                  >
                    <LayoutTemplate className="h-3 w-3" />
                    {t('quickAdd.fromTemplatePill', {
                      defaultValue: 'From template: {{name}}',
                      name: templateSource.name,
                    })}
                  </Badge>
                </div>
              )}

              {templateSource && templateSource.warnings.length > 0 && (
                <Alert className="mb-4" data-testid="quick-add-ticket-template-warnings">
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {templateSource.warnings.map((warning, index) => (
                        <li key={`${index}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {!duplicateSource && templateOptions.length > 0 && (
                <div className="mb-4">
                  <label htmlFor={`${id}-template-select`} className="block text-sm font-medium text-gray-700 mb-1">
                    {t('quickAdd.templateLabel', 'Template')}
                  </label>
                  <CustomSelect
                    id={`${id}-template-select`}
                    value={templateSource?.template_id ?? ''}
                    onValueChange={handleTemplateSelect}
                    disabled={isSubmitting}
                    options={[
                      { value: '', label: t('quickAdd.templateNone', 'None') },
                      ...templateOptions.map((option) => ({ value: option.template_id, label: option.name })),
                    ]}
                  />
                  {templateSource && titleHasTokens(templateSource.title) && (
                    <p className="mt-1 text-xs text-gray-500" data-testid="quick-add-ticket-template-token-hint">
                      {t('quickAdd.templateTokenHint', 'The title fills in the client, contact and due date you pick, until you edit it.')}
                    </p>
                  )}
                </div>
              )}

              {effectiveAssetId && (
                <div className="mb-4 flex pb-2">
                  <Badge
                    variant="secondary"
                    className="inline-flex items-center gap-1.5 rounded-full"
                    data-testid="quick-add-ticket-asset-pill"
                  >
                    <Link2 className="h-3 w-3" />
                    {assetName
                      ? t('create.linkedToAsset', {
                          defaultValue: 'Linked asset: {{name}}',
                          name: assetName,
                        })
                      : t('create.linkedToAssetGeneric', {
                          defaultValue: 'Linked asset',
                        })}
                  </Badge>
                </div>
              )}

              <ReflectionContainer id={`${id}-form`} label={t('quickAdd.formLabel', 'Quick Add Ticket Form')}>
                {/* Use a div instead of form when embedded to avoid nested <form> tags */}
                <FormOrDiv isEmbedded={isEmbedded} onSubmit={handleSubmit}>

                  <Input
                    id={`${id}-title`}
                    ref={titleInputRef}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      clearErrorIfSubmitted();
                    }}
                    placeholder={t('quickAdd.titlePlaceholder', 'Ticket Title *')}
                    className={hasAttemptedSubmit && !title.trim() ? 'border-red-500' : ''}
                    autoFocus
                  />
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700">{t('quickAdd.descriptionLabel', 'Description')}</div>
                    <div className="min-w-0 w-full">
                      <TextEditor
                        key={`${id}-description-editor-${open ? descriptionEditorInstanceKey : 'closed'}`}
                        id={`${id}-description`}
                        initialContent={descriptionContent}
                        onContentChange={(content) => {
                          setDescriptionContent(content);
                          clearErrorIfSubmitted();
                        }}
                        placeholder={t('quickAdd.descriptionPlaceholder', 'Description')}
                        searchMentions={searchUsersForMentions}
                        uploadFile={descriptionUploadSession.uploadFile}
                      />
                    </div>
                  </div>

                  <div className={hasAttemptedSubmit && !clientId ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                    <ClientPicker
                      id={`${id}-client`}
                      clients={filteredClients}
                      onSelect={handleClientChange}
                      selectedClientId={clientId}
                      filterState={clientFilterState}
                      onFilterStateChange={setClientFilterState}
                      clientTypeFilter={clientTypeFilter}
                      onClientTypeFilterChange={setClientTypeFilter}
                      placeholder={t('quickAdd.clientPlaceholder', 'Select Client *')}
                      onAddNew={() => setIsQuickAddClientOpen(true)}
                    />
                  </div>

                  {clientId && selectedClientType === 'company' && (
                    <ContactPicker
                      id={`${id}-contact`}
                      contacts={contacts}
                      value={contactId || ''}
                      onValueChange={(value) => {
                        setContactId(value || null);
                        clearErrorIfSubmitted();
                      }}
                      clientId={clientId}
                      placeholder={
                        contacts.length === 0
                          ? t('quickAdd.noContactsForClient', 'No contacts for selected client')
                          : t('quickAdd.selectContact', 'Select contact')
                      }
                      buttonWidth="full"
                      onAddNew={() => setIsQuickAddContactOpen(true)}
                    />
                  )}
                  {clientId && (
                    <CustomSelect
                      id={`${id}-location`}
                      value={locationId || ''}
                      onValueChange={(value) => {
                        setLocationId(value === 'none' ? null : value || null);
                        clearErrorIfSubmitted();
                      }}
                      options={[
                        ...(locations.length > 0 ? [{ value: 'none', label: t('quickAdd.none', 'None') }] : []),
                        ...locations.map(location => ({
                          value: location.location_id,
                          label: formatLocationDisplay(location, t('quickAdd.unnamedLocation', 'Unnamed Location')) +
                            (location.is_default ? ` ${t('quickAdd.defaultSuffix', '(Default)')}` : '')
                        }))
                      ]}
                      placeholder={locations.length === 0
                        ? t('quickAdd.noLocationsForClient', 'No locations for selected client')
                        : t('quickAdd.selectLocation', 'Select location')}
                      showPlaceholderInDropdown={false}
                    />
                  )}
                  <div className={hasAttemptedSubmit && !boardId ? 'ring-1 ring-red-500 rounded-lg' : ''}>
                    <BoardPicker
                      id={`${id}-board-picker`}
                      boards={boards}
                      onSelect={handleBoardChange}
                      selectedBoardId={boardId}
                      onFilterStateChange={setQuickAddBoardFilterState}
                      filterState={quickAddBoardFilterState}
                      placeholder={t('quickAdd.boardPlaceholder', 'Select Board *')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickAdd.assignedTo', 'Assigned To')}</label>
                      <UserAndTeamPicker
                        value={assignedTo}
                        onValueChange={(value) => {
                          setAssignedTo(value);
                          setAssignedTeamId(null);
                          clearErrorIfSubmitted();
                        }}
                        onTeamSelect={(teamId) => {
                          const team = teams.find(t => t.team_id === teamId);
                          if (team?.manager_id) {
                            setAssignedTo(team.manager_id);
                          }
                          setAssignedTeamId(teamId);
                          // Expand team members into additional agents
                          const members = team?.members || [];
                          const managerId = team?.manager_id || '';
                          const newAgents = members
                            .filter(m => m.user_id !== managerId)
                            .filter(m => !tempAdditionalAgents.some(a => a.user_id === m.user_id))
                            .map(m => ({
                              user_id: m.user_id,
                              first_name: m.first_name || '',
                              last_name: m.last_name || '',
                              temp_id: `temp-${Date.now()}-${m.user_id}`,
                            }));
                          if (newAgents.length > 0) {
                            setTempAdditionalAgents(prev => [...prev, ...newAgents]);
                          }
                          clearErrorIfSubmitted();
                        }}
                        users={users
                          .filter(u => !tempAdditionalAgents.some(a => a.user_id === u.user_id))
                          .map(user => ({ ...user, roles: [] }))}
                        teams={teams}
                        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                        getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                        buttonWidth="full"
                        size="sm"
                        placeholder={t('quickAdd.assignTo', 'Assign To')}
                      />
                      {assignedTeamId && (() => {
                        const assignedTeam = teams.find(t => t.team_id === assignedTeamId);
                        return assignedTeam ? (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <TeamAvatar
                              teamId={assignedTeam.team_id}
                              teamName={assignedTeam.team_name}
                              avatarUrl={teamAvatarUrl}
                              size="xs"
                            />
                            <span className="text-xs text-gray-500 truncate">{assignedTeam.team_name}</span>
                          </div>
                        ) : null;
                      })()}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickAdd.additionalAgents', 'Additional Agents')}</label>
                      <MultiUserAndTeamPicker
                        id={`${id}-additional-agents`}
                        values={tempAdditionalAgents.map(a => a.user_id)}
                        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                        getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                        teams={teams}
                        teamSectionLabel={t('quickAdd.addTeamMembers', 'Add Team Members')}
                        onTeamValuesChange={(selectedTeamIds) => {
                          for (const teamId of selectedTeamIds) {
                            const team = teams.find(t => t.team_id === teamId);
                            if (team?.manager_id) {
                              setAssignedTo(team.manager_id);
                            }
                            setAssignedTeamId(teamId);
                            const members = team?.members || [];
                            const newAgents = members
                              .filter(m => m.user_id !== (team?.manager_id || assignedTo))
                              .filter(m => !tempAdditionalAgents.some(a => a.user_id === m.user_id))
                              .map(m => ({
                                user_id: m.user_id,
                                first_name: m.first_name || '',
                                last_name: m.last_name || '',
                                temp_id: `temp-${Date.now()}-${m.user_id}`,
                              }));
                            if (newAgents.length > 0) {
                              setTempAdditionalAgents(prev => [...prev, ...newAgents]);
                            }
                          }
                        }}
                        onValuesChange={(newUserIds) => {
                          const currentUserIds = tempAdditionalAgents.map(a => a.user_id);
                          const addedUserIds = newUserIds.filter(uid => !currentUserIds.includes(uid));
                          const newAgents = addedUserIds.map(uid => {
                            const user = users.find(u => u.user_id === uid);
                            return {
                              user_id: uid,
                              first_name: user?.first_name || '',
                              last_name: user?.last_name || '',
                              temp_id: `temp-${Date.now()}-${uid}`,
                            };
                          });
                          const removedUserIds = currentUserIds.filter(uid => !newUserIds.includes(uid));
                          setTempAdditionalAgents(prev => [
                            ...prev.filter(a => !removedUserIds.includes(a.user_id)),
                            ...newAgents,
                          ]);
                        }}
                        users={users.filter(u => u.user_id !== assignedTo)}
                        size="sm"
                        placeholder={t('quickAdd.additionalAgentsPlaceholder', 'Additional agents...')}
                      />
                    </div>
                  </div>

                  {boardId && boardConfig.category_type && (
                    <CategoryPicker
                      id={`${id}-category-picker`}
                      categories={categories}
                      selectedCategories={selectedCategories}
                      onSelect={(categoryIds) => {
                        setSelectedCategories(categoryIds);
                        clearErrorIfSubmitted();
                      }}
                      placeholder={boardConfig.category_type === 'custom'
                        ? t('quickAdd.selectCategory', 'Select category')
                        : t('quickAdd.selectItilCategory', 'Select ITIL category')}
                      multiSelect={false}
                      className="w-full"
                      onAddNew={() => setIsQuickAddCategoryOpen(true)}
                    />
                  )}

                  <CustomSelect
                    id={`${id}`}
                    value={statusId}
                    onValueChange={(value) => {
                      setStatusId(value);
                      clearErrorIfSubmitted();
                    }}
                    options={memoizedStatusOptions}
                    placeholder={t('quickAdd.statusPlaceholder', 'Select Status *')}
                    className={hasAttemptedSubmit && !statusId ? 'border-red-500' : ''}
                    disabled={!boardId || isLoadingStatuses}
                  />

                  {/* Priority Section - Show different UI based on board priority type */}
                  {boardId && (
                    <>
                      {/* Custom Priority - Editable dropdown (only show if explicitly custom, not by default) */}
                      {boardConfig.priority_type && boardConfig.priority_type === 'custom' && (
                        <CustomSelect
                          id={`${id}-priority`}
                          value={priorityId}
                          onValueChange={(value) => {
                            setPriorityId(value);
                            clearErrorIfSubmitted();
                          }}
                          options={memoizedPriorityOptions}
                          placeholder={t('quickAdd.selectPriority', 'Select Priority *')}
                          className={hasAttemptedSubmit && !priorityId ? 'border-red-500' : ''}
                        />
                      )}

                      {/* ITIL Priority - Show Impact and Urgency fields */}
                      {boardConfig.priority_type === 'itil' && (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('itil.impact', 'Impact')} *</label>
                            <CustomSelect
                              options={itilImpactOptions}
                              value={itilImpact?.toString() || null}
                              onValueChange={(value) => {
                                setItilImpact(value ? parseInt(value) : undefined);
                                clearErrorIfSubmitted();
                              }}
                              placeholder={t('itil.selectImpact', 'Select Impact')}
                              className={hasAttemptedSubmit && !itilImpact ? 'border-red-500' : ''}
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t('itil.urgency', 'Urgency')} *</label>
                            <CustomSelect
                              options={itilUrgencyOptions}
                              value={itilUrgency?.toString() || null}
                              onValueChange={(value) => {
                                setItilUrgency(value ? parseInt(value) : undefined);
                                clearErrorIfSubmitted();
                              }}
                              placeholder={t('itil.selectUrgency', 'Select Urgency')}
                              className={hasAttemptedSubmit && !itilUrgency ? 'border-red-500' : ''}
                            />
                          </div>

                          {/* Read-only Priority field showing calculated value */}
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <label className="block text-sm font-medium text-gray-700">{t('quickAdd.priorityCalculated', 'Priority (Calculated)')}</label>
                              <button
                                type="button"
                                onClick={() => setShowPriorityMatrix(!showPriorityMatrix)}
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                title={t('quickAdd.showPriorityMatrix', 'Show ITIL Priority Matrix')}
                              >
                                <HelpCircle className="w-4 h-4" />
                              </button>
                            </div>
                            <div className={`w-full px-3 py-2 border rounded-md bg-gray-50 ${
                              hasAttemptedSubmit && (!itilImpact || !itilUrgency) ? 'border-red-500' : 'border-gray-300'
                            }`}>
                              {calculatedItilPriority ? (
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full border border-gray-300"
                                    style={{ backgroundColor:
                                      calculatedItilPriority === 1 ? '#DC2626' : // Red
                                      calculatedItilPriority === 2 ? '#EA580C' : // Orange
                                      calculatedItilPriority === 3 ? '#F59E0B' : // Amber
                                      calculatedItilPriority === 4 ? '#3B82F6' : // Blue
                                      '#6B7280' // Gray
                                    }}
                                  />
                                  <span className="text-gray-900">
                                    {t(`itil.priorityLevels.${calculatedItilPriority}` as const, ItilLabels.priority[calculatedItilPriority])}
                                  </span>
                                  <span className="text-sm text-gray-500">
                                    ({t('itil.impact', 'Impact')} {itilImpact} × {t('itil.urgency', 'Urgency')} {itilUrgency})
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-500">{t('itil.calculatePrompt', 'Select Impact and Urgency to calculate priority')}</span>
                              )}
                            </div>

                            {/* ITIL Priority Matrix - Show when help icon is clicked */}
                            {showPriorityMatrix && (
                              <div className="mt-3 p-4 bg-gray-500/10 border rounded-lg">
                                <h4 className="text-sm font-medium mb-3">{t('itil.matrixTitle', 'ITIL Priority Matrix (Impact × Urgency)')}</h4>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs">
                                    <thead>
                                      <tr>
                                        <th className="px-2 py-1 text-left text-gray-600 border-b"></th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">{t('itil.urgencyAxis.1', 'High\nUrgency (1)').split('\n').map((line, index) => <React.Fragment key={`urgency-1-${index}`}>{index > 0 && <br />}{line}</React.Fragment>)}</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">{t('itil.urgencyAxis.2', 'Medium-High\nUrgency (2)').split('\n').map((line, index) => <React.Fragment key={`urgency-2-${index}`}>{index > 0 && <br />}{line}</React.Fragment>)}</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">{t('itil.urgencyAxis.3', 'Medium\nUrgency (3)').split('\n').map((line, index) => <React.Fragment key={`urgency-3-${index}`}>{index > 0 && <br />}{line}</React.Fragment>)}</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">{t('itil.urgencyAxis.4', 'Medium-Low\nUrgency (4)').split('\n').map((line, index) => <React.Fragment key={`urgency-4-${index}`}>{index > 0 && <br />}{line}</React.Fragment>)}</th>
                                        <th className="px-2 py-1 text-center text-gray-600 border-b">{t('itil.urgencyAxis.5', 'Low\nUrgency (5)').split('\n').map((line, index) => <React.Fragment key={`urgency-5-${index}`}>{index > 0 && <br />}{line}</React.Fragment>)}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.1', 'High Impact (1)')}</td>
                                        <td className="px-2 py-1 text-center bg-red-500/15 text-red-600 dark:text-red-400 font-semibold">{t('itil.priorityLevels.1', 'Critical (1)')}</td>
                                        <td className="px-2 py-1 text-center bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                                        <td className="px-2 py-1 text-center bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.2', 'Medium-High Impact (2)')}</td>
                                        <td className="px-2 py-1 text-center bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                                        <td className="px-2 py-1 text-center bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.3', 'Medium Impact (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-orange-500/15 text-orange-600 dark:text-orange-400 font-semibold">{t('itil.priorityLevels.2', 'High (2)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                                        <td className="px-2 py-1 text-center bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.4', 'Medium-Low Impact (4)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                                        <td className="px-2 py-1 text-center bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                                        <td className="px-2 py-1 text-center bg-gray-500/15 text-gray-600 dark:text-gray-400 font-semibold">{t('itil.priorityLevels.5', 'Planning (5)')}</td>
                                      </tr>
                                      <tr>
                                        <td className="px-2 py-1 text-gray-600 border-r font-medium">{t('itil.impactAxis.5', 'Low Impact (5)')}</td>
                                        <td className="px-2 py-1 text-center bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 font-semibold">{t('itil.priorityLevels.3', 'Medium (3)')}</td>
                                        <td className="px-2 py-1 text-center bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                                        <td className="px-2 py-1 text-center bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold">{t('itil.priorityLevels.4', 'Low (4)')}</td>
                                        <td className="px-2 py-1 text-center bg-gray-500/15 text-gray-600 dark:text-gray-400 font-semibold">{t('itil.priorityLevels.5', 'Planning (5)')}</td>
                                        <td className="px-2 py-1 text-center bg-gray-500/15 text-gray-600 dark:text-gray-400 font-semibold">{t('itil.priorityLevels.5', 'Planning (5)')}</td>
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
                        </>
                      )}
                    </>
                  )}

                  {/* ITIL Categories are now handled by the unified CategoryPicker above */}

                  {/* Due Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('quickAdd.dueDate', 'Due Date')}</label>
                    <div className="w-72">
                      <DateTimePicker
                        id={`${id}-due-date`}
                        value={dueDate}
                        onChange={(date) => setDueDate(date)}
                        clearable
                        placeholder={t('quickAdd.selectDate', 'Select date')}
                        label={t('quickAdd.dueDate', 'Due Date')}
                      />
                    </div>
                  </div>

                  {duplicateSource && duplicateSource.checklist.length > 0 && (
                    <div className="space-y-2" data-testid="quick-add-ticket-duplicate-checklist">
                      <div className="text-sm font-medium text-gray-700">
                        {t('quickAdd.duplicateChecklistHeading', {
                          defaultValue: 'Checklist from #{{number}}',
                          number: duplicateSource.ticket_number,
                        })}
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-600">
                        {duplicateSource.checklist.map((item, index) => (
                          <li key={`${index}-${item.item_name}`}>
                            {item.item_name}
                            {item.is_required && (
                              <span className="ml-1 text-xs text-gray-500">
                                {t('quickAdd.duplicateChecklistRequired', '(required)')}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <Checkbox
                        id={`${id}-copy-checklist`}
                        checked={copyChecklist}
                        onChange={(e) => setCopyChecklist(e.target.checked)}
                        label={t('quickAdd.duplicateCopyChecklist', 'Copy checklist items (unchecked)')}
                        disabled={isSubmitting}
                      />
                    </div>
                  )}
                  {duplicateSource && duplicateSource.custom_field_count > 0 && (
                    <p className="text-xs text-gray-500" data-testid="quick-add-ticket-duplicate-custom-fields">
                      {t('quickAdd.duplicateCustomFieldsNote', {
                        defaultValue: 'Custom field values are copied from #{{number}}.',
                        number: duplicateSource.ticket_number,
                      })}
                    </p>
                  )}

                  {templateSource && templateSource.checklist.length > 0 && (
                    <div className="space-y-2" data-testid="quick-add-ticket-template-checklist">
                      <div className="text-sm font-medium text-gray-700">
                        {t('quickAdd.templateChecklistHeading', {
                          defaultValue: 'Checklist from template: {{name}}',
                          name: templateSource.name,
                        })}
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-600">
                        {templateSource.checklist.map((item, index) => (
                          <li key={`${index}-${item.item_name}`}>
                            {item.item_name}
                            {item.is_required && (
                              <span className="ml-1 text-xs text-gray-500">
                                {t('quickAdd.duplicateChecklistRequired', '(required)')}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <Checkbox
                        id={`${id}-copy-template-checklist`}
                        checked={copyTemplateChecklist}
                        onChange={(e) => setCopyTemplateChecklist(e.target.checked)}
                        label={t('quickAdd.duplicateCopyChecklist', 'Copy checklist items (unchecked)')}
                        disabled={isSubmitting}
                      />
                    </div>
                  )}
                  {templateSource && templateSource.custom_field_count > 0 && (
                    <p className="text-xs text-gray-500" data-testid="quick-add-ticket-template-custom-fields">
                      {t('quickAdd.templateCustomFieldsNote', {
                        defaultValue: 'Custom field values are copied from the template.',
                      })}
                    </p>
                  )}

                  <div className="space-y-4" data-testid="quick-add-ticket-extras">
                    {!isAlgaDeskMode && (
                      <div id={`${id}-assets-section`} className="space-y-2" data-testid="quick-add-ticket-assets">
                        <div className="text-sm font-medium text-gray-700">{t('quickAdd.assets.heading', 'Assets')}</div>
                        {renderAssetPicker && clientId ? (
                          renderAssetPicker({
                            id: `${id}-assets`,
                            clientId,
                            value: extraAssetIds,
                            onChange: setExtraAssetIds,
                            label: '',
                            disabled: isSubmitting,
                          })
                        ) : (
                          <p className="text-xs text-gray-500">
                            {renderAssetPicker
                              ? t('quickAdd.assets.selectClientFirst', 'Select a client to link assets.')
                              : t('quickAdd.assets.unavailable', 'Assets can be linked from the ticket after it is created.')}
                          </p>
                        )}
                      </div>
                    )}

                    <div id={`${id}-attachments-section`} className="space-y-2" data-testid="quick-add-ticket-attachments">
                      <div className="text-sm font-medium text-gray-700">{t('quickAdd.attachments.heading', 'Attachments')}</div>
                      <input
                        ref={attachmentInputRef}
                        id={`${id}-attachments-input`}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const picked = Array.from(e.target.files ?? []);
                          if (picked.length > 0) setAttachments((current) => [...current, ...picked]);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        id={`${id}-attachments-add`}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => attachmentInputRef.current?.click()}
                        disabled={isSubmitting}
                      >
                        <Paperclip className="h-4 w-4 mr-1" />
                        {t('quickAdd.attachments.add', 'Add files')}
                      </Button>
                      {attachments.length > 0 && (
                        <ul className="space-y-1" id={`${id}-attachments-list`}>
                          {attachments.map((file, index) => (
                            <li key={`${index}-${file.name}-${file.size}`} className="flex items-center gap-2 text-sm text-gray-700">
                              <span className="truncate">{file.name}</span>
                              <Button
                                id={`${id}-attachment-remove-${index}`}
                                type="button"
                                variant="icon"
                                size="icon"
                                aria-label={t('quickAdd.attachments.remove', { defaultValue: 'Remove {{name}}', name: file.name })}
                                onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}
                                disabled={isSubmitting}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {(
                      <div id={`${id}-watchers-section`} className="space-y-2" data-testid="quick-add-ticket-watchers">
                        <div className="text-sm font-medium text-gray-700">{t('quickAdd.watchers.heading', 'Watchers')}</div>
                        <MultiUserPicker
                          id={`${id}-watchers`}
                          values={watcherIds}
                          onValuesChange={setWatcherIds}
                          users={users}
                          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                          disabled={isSubmitting}
                          placeholder={t('quickAdd.watchers.placeholder', 'Add watchers...')}
                        />
                      </div>
                    )}
                  </div>

                  <QuickAddTagPicker
                    id="quick-add-ticket-tags"
                    entityType="ticket"
                    pendingTags={pendingTags}
                    onPendingTagsChange={setPendingTags}
                    disabled={isSubmitting}
                  />

                  {renderBeforeFooter?.()}
                </FormOrDiv>
              </ReflectionContainer>
            </>
          )}
        </DialogContent>
      </Dialog>
      {renderQuickAddContact({
        isOpen: isQuickAddContactOpen,
        onClose: () => setIsQuickAddContactOpen(false),
        onContactAdded: (newContact) => {
          setContacts((prevContacts) => {
            const existingIndex = prevContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
            if (existingIndex >= 0) {
              const nextContacts = [...prevContacts];
              nextContacts[existingIndex] = newContact;
              return nextContacts;
            }
            return [...prevContacts, newContact];
          });
          setContactId(newContact.contact_name_id);
          setIsQuickAddContactOpen(false);
        },
        clients,
        selectedClientId: clientId,
      })}
      {renderQuickAddClient({
        open: isQuickAddClientOpen,
        onOpenChange: setIsQuickAddClientOpen,
        onClientAdded: (newClient) => {
          setClients(prev => [...prev, newClient]);
          handleClientChange(newClient.client_id);
        },
        skipSuccessDialog: true,
      })}
      <QuickAddCategory
        isOpen={isQuickAddCategoryOpen}
        onClose={() => setIsQuickAddCategoryOpen(false)}
        onCategoryCreated={(newCategory) => {
          setCategories((prevCategories) => {
            const existingIndex = prevCategories.findIndex((category) => category.category_id === newCategory.category_id);
            if (existingIndex >= 0) {
              const nextCategories = [...prevCategories];
              nextCategories[existingIndex] = newCategory;
              return nextCategories;
            }
            return [...prevCategories, newCategory];
          });
          setSelectedCategories([newCategory.category_id]);
          clearErrorIfSubmitted();
          setIsQuickAddCategoryOpen(false);
        }}
        preselectedBoardId={boardId}
        categories={categories}
      />
      <ConfirmationDialog
        id={`${id}-description-clipboard-draft-cancel-dialog`}
        isOpen={descriptionUploadSession.showDraftCancelDialog}
        onClose={() => descriptionUploadSession.setShowDraftCancelDialog(false)}
        onConfirm={descriptionUploadSession.deleteTrackedDraftClipboardImages}
        title={t('conversation.clipboardDraftCancelTitle', 'Pasted Images Detected')}
        message={t('quickAdd.clipboardDraftMessage', 'This quick-add description includes pasted images that have not been attached to a saved ticket yet. Continue editing, or delete the staged images and close?')}
        confirmLabel={t('conversation.deleteUploadedImages', 'Delete Images')}
        cancelLabel={t('quickAdd.continueEditing', 'Continue Editing')}
        isConfirming={descriptionUploadSession.isDeletingDraftImages}
      />
      <ConfirmationDialog
        id={`${id}-template-replace-dialog`}
        isOpen={pendingTemplateId !== null}
        onClose={() => setPendingTemplateId(null)}
        onConfirm={() => {
          const nextTemplateId = pendingTemplateId;
          setPendingTemplateId(null);
          if (nextTemplateId) void loadAndApplyTemplate(nextTemplateId);
        }}
        title={t('quickAdd.templateReplaceTitle', 'Replace your changes?')}
        message={t('quickAdd.templateReplaceMessage', 'Applying a template replaces the title, description and other fields you have entered.')}
        confirmLabel={t('quickAdd.templateReplaceConfirm', 'Apply template')}
        cancelLabel={t('quickAdd.continueEditing', 'Continue Editing')}
      />
    </div>
  );
}
