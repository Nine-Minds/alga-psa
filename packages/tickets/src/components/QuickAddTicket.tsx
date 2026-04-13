// @ts-nocheck
// TODO: Priority index signature issue
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { HelpCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import Spinner from '@alga-psa/ui/components/Spinner';
import { addTicket, updateTicket } from '../actions/ticketActions';
import { addTicketResource } from '../actions/ticketResourceActions';
import { getCurrentUser, getUserAvatarUrlsBatchAction, searchUsersForMentions } from '@alga-psa/user-composition/actions';
import { getContactsByClient, getClientLocations } from '../actions/clientLookupActions';
import { getTicketFormData } from '../actions/ticketFormActions';
import { getTicketCategoriesByBoard, BoardCategoryData } from '@alga-psa/tickets/actions';
import { IUser, IBoard, ITicketStatus, IPriority, IStandardPriority, IClient, IClientLocation, IContact, ITicket, ITicketCategory } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { CategoryPicker } from './CategoryPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
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
import { QuickAddTagPicker } from '@alga-psa/tags/components';
import type { PendingTag } from '@alga-psa/types';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { TimePicker } from '@alga-psa/ui/components/TimePicker';
import { createTagsForEntity } from '@alga-psa/tags/actions';
import { getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { assignTeamToTicket } from '@alga-psa/tickets/actions';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import type { ITeam } from '@alga-psa/types';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuickAddClient } from '@alga-psa/ui/context';
import QuickAddCategory from './QuickAddCategory';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { parseTicketRichTextContent, serializeTicketRichTextContent } from '../lib/ticketRichText';
import { removeTicketRichTextImageUrls, replaceTicketRichTextImageUrls } from '../lib/ticketRichTextImages';
import { useQuickAddRichTextUploadSession } from './useQuickAddRichTextUploadSession';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';

/** Renders a <form> normally, or a plain <div> when embedded to avoid nested form tags. */
function FormOrDiv({ isEmbedded, onSubmit, children }: { isEmbedded: boolean; onSubmit: (e: React.FormEvent) => void; children: React.ReactNode }) {
  if (isEmbedded) {
    return <div className="space-y-4">{children}</div>;
  }
  return <form onSubmit={onSubmit} className="space-y-4" noValidate>{children}</form>;
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
  renderBeforeFooter?: () => React.ReactNode;
}

export function QuickAddTicket({
  id = 'ticket-quick-add',
  open,
  onOpenChange,
  onTicketAdded,
  prefilledClient,
  prefilledContact,
  prefilledDescription,
  prefilledTitle,
  prefilledAssignedTo,
  prefilledDueDate,
  prefilledAdditionalAgents,
  isEmbedded = false,
  assetId,
  renderBeforeFooter
}: QuickAddTicketProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { renderQuickAddClient, renderQuickAddContact } = useQuickAddClient();
  const { t } = useTranslation('features/tickets');
  const { enabled: teamsV2Enabled } = useFeatureFlag('teams-v2', { defaultValue: false });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const [dueDateDate, setDueDateDate] = useState<Date | undefined>(() => {
    if (!prefilledDueDate) return undefined;
    const parsed = typeof prefilledDueDate === 'string' ? new Date(prefilledDueDate) : prefilledDueDate;
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  });
  const [dueDateTime, setDueDateTime] = useState<string | undefined>(undefined);
  // ITIL-specific state
  const [itilImpact, setItilImpact] = useState<number | undefined>(undefined);
  const [itilUrgency, setItilUrgency] = useState<number | undefined>(undefined);
  const [showPriorityMatrix, setShowPriorityMatrix] = useState(false);

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
        const formData = await getTicketFormData(prefilledClient?.id);

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
          const parsed = typeof prefilledDueDate === 'string' ? new Date(prefilledDueDate) : prefilledDueDate;
          setDueDateDate(Number.isNaN(parsed.getTime()) ? undefined : parsed);
        }
      } catch (error) {
        console.error('Error fetching form data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [open, prefilledClient?.id]);

  useEffect(() => {
    if (!open || !teamsV2Enabled) {
      setTeams([]);
      return;
    }
    const fetchTeamsData = async () => {
      try {
        const fetchedTeams = await getTeams();
        setTeams(fetchedTeams);
      } catch (err) {
        console.error('Error fetching teams:', err);
      }
    };
    fetchTeamsData();
  }, [open, teamsV2Enabled]);

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
    if (isPrefilledClient) return;

    setClientId(newClientId || '');
    setContactId(null);
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
    setIsQuickAddContactOpen(false);
    if (prefilledDueDate) {
      const parsed = typeof prefilledDueDate === 'string' ? new Date(prefilledDueDate) : prefilledDueDate;
      setDueDateDate(Number.isNaN(parsed.getTime()) ? undefined : parsed);
    } else {
      setDueDateDate(undefined);
    }
    setDueDateTime(undefined);
    setError(null);
    setHasAttemptedSubmit(false);
    descriptionUploadSession.resetDraftTracking();
  }

  const handleClose = () => {
    descriptionUploadSession.requestDiscard();
  };


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
      const documentUrl = uploadedDocument.file_id
        ? `/api/documents/view/${uploadedDocument.file_id}`
        : `/api/documents/download/${uploadedDocument.document_id}`;

      replacementUrls.set(stagedImage.url, documentUrl);
    }

    const finalizedDescriptionContent = replaceTicketRichTextImageUrls(
      descriptionContent,
      replacementUrls
    );
    const serializedDescription = serializeTicketRichTextContent(finalizedDescriptionContent);

    await updateTicket(newTicket.ticket_id, {
      attributes: {
        ...(newTicket.attributes || {}),
        description: serializedDescription,
      },
      updated_at: new Date().toISOString(),
    });

    return serializedDescription;
  };

  const handleCreateTicket = async ({ openAfterCreate = false }: { openAfterCreate?: boolean } = {}) => {
    setHasAttemptedSubmit(true);

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join('\n'));
      return;
    }

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

      if (assetId) {
        formData.append('asset_id', assetId);
      }

      // Add ITIL Impact and Urgency for calculation (if provided)
      if (itilImpact) {
        formData.append('itil_impact', itilImpact.toString());
      }
      if (itilUrgency) {
        formData.append('itil_urgency', itilUrgency.toString());
      }

      // Add due date if provided (combine date and optional time)
      if (dueDateDate) {
        const combinedDate = new Date(dueDateDate);
        if (dueDateTime) {
          const [hours, minutes] = dueDateTime.split(':').map(Number);
          combinedDate.setHours(hours, minutes, 0, 0);
        } else {
          // No time specified - use midnight (00:00)
          combinedDate.setHours(0, 0, 0, 0);
        }
        formData.append('due_date', combinedDate.toISOString());
      }

      // ITIL categories now use the unified category system
      // The selected ITIL category ID is already in selectedCategories/categoryId

      const newTicket = await addTicket(formData);
      if (!newTicket) {
        throw new Error(t('errors.createTicketFailed', 'Failed to create ticket. Please try again.'));
      }

      let finalizedDescription = serializeTicketRichTextContent(descriptionForCreate);
      try {
        finalizedDescription = await finalizeDescriptionForCreatedTicket(newTicket);
      } catch (descriptionFinalizeError) {
        console.error('Failed to finalize quick add description:', descriptionFinalizeError);
        toast.error(t('quickAdd.clipboardUploadPartialFailure', 'Ticket created, but pasted images could not be attached to the description.'));
      }

      // Assign team if selected
      if (assignedTeamId && newTicket.ticket_id) {
        try {
          await assignTeamToTicket(newTicket.ticket_id, assignedTeamId);
        } catch (teamError) {
          console.error('Failed to assign team:', teamError);
          toast.error(t('quickAdd.teamAssignmentPartialFailure', 'Ticket created but team assignment failed'));
        }
      }

      // Add additional agents as ticket resources
      if (tempAdditionalAgents.length > 0 && newTicket.ticket_id) {
        for (const agent of tempAdditionalAgents) {
          try {
            await addTicketResource(newTicket.ticket_id, agent.user_id, 'support');
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

      // Pass ticket with tags to callback
      await onTicketAdded({
        ...newTicket,
        attributes: {
          ...(newTicket.attributes || {}),
          description: finalizedDescription,
        },
        tags: createdTags,
      });
      resetForm();

      onOpenChange(false);

      if (openAfterCreate && newTicket.ticket_id) {
        router.push(`/msp/tickets/${newTicket.ticket_id}`);
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
      setError(error instanceof Error ? error.message : t('errors.createTicketFailed', 'Failed to create ticket. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await handleCreateTicket();
  };

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
    () =>
      priorities.map((priority): SelectOption => ({
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
      })),
    [priorities]
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
        disabled={isSubmitting}
        onClick={() => {
          void handleCreateTicket({ openAfterCreate: true });
        }}
        className={hasRequiredFieldErrors ? 'opacity-50' : ''}
      >
        {isSubmitting
          ? t('quickAdd.submitting', 'Adding...')
          : t('quickAdd.createAndView', 'Create + View Ticket')}
      </Button>
      <Button
        id={`${id}-submit-btn`}
        type="button"
        variant="default"
        disabled={isSubmitting}
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
        className="w-full max-w-2xl max-h-[90vh]"
        title={t('quickAdd.dialogTitle', 'Quick Add Ticket')}
        disableFocusTrap
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

              <ReflectionContainer id={`${id}-form`} label={t('quickAdd.formLabel', 'Quick Add Ticket Form')}>
                {/* Use a div instead of form when embedded to avoid nested <form> tags */}
                <FormOrDiv isEmbedded={isEmbedded} onSubmit={handleSubmit}>

                  <Input
                    id={`${id}-title`}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      clearErrorIfSubmitted();
                    }}
                    placeholder={t('quickAdd.titlePlaceholder', 'Ticket Title *')}
                    className={hasAttemptedSubmit && !title.trim() ? 'border-red-500' : ''}
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
                      {teamsV2Enabled ? (
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
                      ) : (
                        <UserPicker
                          value={assignedTo}
                          onValueChange={(value) => {
                            setAssignedTo(value);
                            clearErrorIfSubmitted();
                          }}
                          users={users
                            .filter(u => !tempAdditionalAgents.some(a => a.user_id === u.user_id))
                            .map(user => ({ ...user, roles: [] }))}
                          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                          buttonWidth="full"
                          size="sm"
                          placeholder={t('quickAdd.assignTo', 'Assign To')}
                        />
                      )}
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
                      {teamsV2Enabled ? (
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
                      ) : (
                        <MultiUserPicker
                          id={`${id}-additional-agents`}
                          values={tempAdditionalAgents.map(a => a.user_id)}
                          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
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
                      )}
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
                    <div className="flex items-center gap-2 w-fit">
                      <div className="w-fit">
                        <DatePicker
                          id={`${id}-due-date`}
                          value={dueDateDate}
                          onChange={(date) => setDueDateDate(date)}
                          placeholder={t('quickAdd.selectDate', 'Select date')}
                        />
                      </div>
                      <div className="w-fit">
                        <TimePicker
                          id={`${id}-due-time`}
                          value={dueDateTime}
                          onChange={(time) => setDueDateTime(time)}
                          placeholder={t('quickAdd.timePlaceholder', 'Time')}
                          disabled={!dueDateDate}
                        />
                      </div>
                      {(dueDateDate || dueDateTime) && (
                        <Button
                          id={`${id}-clear-due-date`}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDueDateDate(undefined);
                            setDueDateTime(undefined);
                          }}
                          className="text-gray-400 hover:text-gray-600 px-2"
                        >
                          ✕
                        </Button>
                      )}
                    </div>
                    {dueDateDate && !dueDateTime && (
                      <p className="text-xs text-gray-500 mt-1">{t('quickAdd.noTimeDefault', 'No time set - defaults to 12:00 AM')}</p>
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
    </div>
  );
}
