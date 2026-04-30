'use client';

import React, { useEffect, useMemo, useState } from 'react';

import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { getAllContacts, getContactsByClient } from '@alga-psa/clients/actions';
import { getAvailableStatuses, getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { getAllUsersBasic, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeamAvatarUrlsBatchAction, getTeamsBasic } from '@alga-psa/teams/actions';
import { getTicketById, getTicketsForList } from '@alga-psa/tickets/actions';
import { getProjectsWithPhases } from '@alga-psa/projects/actions/projectActions';
import { getProjectTaskData } from '@alga-psa/projects/actions/projectTaskActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TFunction } from 'i18next';
import type {
  IBoard,
  IClient,
  IContact,
  IUser,
  ITeam,
  TicketFieldOptions,
} from '@alga-psa/types';
import type { InputMapping, MappingValue } from '@alga-psa/workflows/runtime';

export type WorkflowActionInputPickerField = {
  name: string;
  nullable?: boolean;
  editor?: {
    kind: 'text' | 'picker' | 'color' | 'json' | 'custom';
    dependencies?: string[];
    fixedValueHint?: string;
    allowsDynamicReference?: boolean;
    picker?: {
      resource: string;
    };
  };
  picker?: {
    kind: string;
    dependencies?: string[];
    fixedValueHint?: string;
  };
};

type DependencyStatus = 'fixed' | 'missing' | 'dynamic';

type DependencyResolution = {
  path: string;
  status: DependencyStatus;
  value?: string;
};

type WorkflowPickerOption = SelectOption & {
  boardId?: string | null;
  clientId?: string | null;
  parentId?: string | null;
  projectId?: string | null;
  phaseId?: string | null;
  assigneeType?: 'user' | 'team';
};

type WorkflowTicketSearchResult = {
  ticket_id: string;
  ticket_number?: string | null;
  title?: string | null;
  status_name?: string | null;
};

type WorkflowProjectPickerProject = {
  project_id: string;
  project_name: string;
  phases?: Array<{
    phase_id: string;
    phase_name: string;
    statuses?: Array<{ mapping_id: string; name: string }>;
  }>;
};

type WorkflowProjectTaskPickerTask = {
  task_id: string;
  task_name: string;
  phase_id?: string | null;
};

type WorkflowProjectStatusPickerStatus = {
  mapping_id: string;
  name: string;
  project_id: string;
  phase_id?: string | null;
};

type WorkflowPickerData = {
  ticketOptions: TicketFieldOptions | null;
  contacts: IContact[];
  users: IUser[];
  teams: ITeam[];
  tickets: WorkflowTicketSearchResult[];
  projects: WorkflowProjectPickerProject[];
  projectTasks: WorkflowProjectTaskPickerTask[];
  projectStatuses: WorkflowProjectStatusPickerStatus[];
};

const EMPTY_PICKER_DATA: WorkflowPickerData = {
  ticketOptions: null,
  contacts: [],
  users: [],
  teams: [],
  tickets: [],
  projects: [],
  projectTasks: [],
  projectStatuses: [],
};

const EMPTY_TICKET_FIELD_OPTIONS: TicketFieldOptions = {
  boards: [],
  statuses: [],
  priorities: [],
  categories: [],
  clients: [],
  users: [],
  locations: [],
};

type DependencyHintDefaults = Partial<Record<string, Record<string, string>>>;

const TICKET_PICKER_DEPENDENCY_HINT_DEFAULTS: DependencyHintDefaults = {
  contact: {
    client_id: 'Choose a fixed Client first to load contact options.',
  },
  'client-location': {
    client_id: 'Choose a fixed Client first to load location options.',
  },
  'ticket-category': {
    board_id: 'Choose a fixed Board first to load category options.',
  },
  'ticket-status': {
    board_id: 'Choose a fixed Board first to load status options.',
    ticket_id: 'Choose a fixed Ticket first to load status options.',
  },
  'ticket-subcategory': {
    board_id: 'Choose a fixed Board first to load subcategory options.',
    category_id: 'Choose a fixed Category first to load subcategory options.',
  },
  'project-phase': {
    project_id: 'Choose a fixed Project first to load phase options.',
    target_project_id: 'Choose a fixed Project first to load phase options.',
    'filters.project_id': 'Choose a fixed Project first to load phase options.',
  },
  'project-task': {
    project_id: 'Choose a fixed Project first to load task options.',
    phase_id: 'Choose a fixed Phase first to load task options.',
    target_project_id: 'Choose a fixed Project first to load task options.',
    target_phase_id: 'Choose a fixed Phase first to load task options.',
    'filters.project_id': 'Choose a fixed Project first to load task options.',
    'filters.phase_id': 'Choose a fixed Phase first to load task options.',
  },
  'project-task-status': {
    project_id: 'Choose a fixed Project first to load status options.',
    phase_id: 'Choose a fixed Phase first to load status options.',
    target_project_id: 'Choose a fixed Project first to load status options.',
    target_phase_id: 'Choose a fixed Phase first to load status options.',
    'filters.project_id': 'Choose a fixed Project first to load status options.',
    'filters.phase_id': 'Choose a fixed Phase first to load status options.',
  },
};

export const WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES = new Set([
  'board',
  'client',
  'project',
  'project-phase',
  'project-task',
  'project-task-status',
  'contact',
  'user',
  'user-or-team',
  'ticket',
  'ticket-status',
  'ticket-priority',
  'ticket-category',
  'ticket-subcategory',
  'client-location',
]);

const DEDICATED_PICKER_KINDS = new Set([
  'board',
  'client',
  'contact',
  'user',
  'user-or-team',
  'ticket',
]);

const getPathSegments = (path: string): string[] =>
  path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

const getValueAtPath = (value: unknown, path: string): unknown => {
  const segments = getPathSegments(path);
  let current = value;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isNaN(index) ? undefined : current[index];
      continue;
    }

    if (!current || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

const resolveDependency = (
  rootInputMapping: InputMapping,
  dependencyPath: string
): DependencyResolution => {
  const rawValue = getValueAtPath(rootInputMapping, dependencyPath) as MappingValue | undefined;

  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    return {
      path: dependencyPath,
      status: 'fixed',
      value: rawValue,
    };
  }

  if (rawValue && typeof rawValue === 'object') {
    if ('$expr' in rawValue || '$secret' in rawValue) {
      return {
        path: dependencyPath,
        status: 'dynamic',
      };
    }
  }

  return {
    path: dependencyPath,
    status: 'missing',
  };
};

const buildDisabledExplanation = (
  t: TFunction,
  kind: string,
  dependencies: DependencyResolution[]
): string | undefined => {
  const hints = TICKET_PICKER_DEPENDENCY_HINT_DEFAULTS[kind];
  if (!hints) return undefined;

  const unresolved = dependencies.find((dependency) => dependency.status !== 'fixed' && hints[dependency.path]);
  if (!unresolved) return undefined;
  return t(`actionInputFixedPicker.dependencyHints.${kind}.${unresolved.path}`, {
    defaultValue: hints[unresolved.path],
  });
};

const getAssignmentTypeDependencyValue = (
  dependencyValues: Map<string, string>
): 'user' | 'team' | 'queue' | undefined => {
  const candidatePaths = ['assignee.type', 'assignment.primary.type', 'patch.assignment.primary.type'];

  for (const candidatePath of candidatePaths) {
    const value = dependencyValues.get(candidatePath);
    if (value === 'user' || value === 'team' || value === 'queue') {
      return value;
    }
  }

  return undefined;
};

const getWorkflowPickerPlaceholder = (
  t: TFunction,
  field: WorkflowActionInputPickerField,
  isLoading: boolean,
  explanation?: string
): string => {
  if (isLoading) {
    return t('actionInputFixedPicker.loadingOptions', { defaultValue: 'Loading options...' });
  }

  if (explanation) {
    return explanation;
  }

  const hint = field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim();
  if (hint) {
    return hint;
  }

  return `Select ${field.name.replace(/_/g, ' ')}`;
};

const toBoards = (ticketOptions: TicketFieldOptions | null): IBoard[] =>
  (ticketOptions?.boards ?? []).map((board) => ({
    board_id: board.id,
    board_name: board.name,
    is_default: board.is_default,
    is_inactive: false,
  } as IBoard));

const toClients = (ticketOptions: TicketFieldOptions | null): IClient[] =>
  (ticketOptions?.clients ?? []).map((client) => ({
    client_id: client.id,
    client_name: client.name,
    is_inactive: false,
  } as IClient));

const mapTicketFieldOptions = (
  kind: string,
  ticketOptions: TicketFieldOptions | null
): WorkflowPickerOption[] => {
  if (!ticketOptions) {
    return [];
  }

  switch (kind) {
    case 'board':
      return ticketOptions.boards.map((board) => ({
        value: board.id,
        label: board.name,
      }));
    case 'client':
      return ticketOptions.clients.map((client) => ({
        value: client.id,
        label: client.name,
      }));
    case 'ticket-status':
      return ticketOptions.statuses.map((status) => ({
        value: status.id,
        label: status.name,
      }));
    case 'ticket-priority':
      return ticketOptions.priorities.map((priority) => ({
        value: priority.id,
        label: priority.name,
      }));
    case 'ticket-category':
    case 'ticket-subcategory':
      return ticketOptions.categories.map((category) => ({
        value: category.id,
        label: category.name,
        boardId: category.board_id ?? null,
        parentId: category.parent_id ?? null,
      }));
    case 'client-location':
      return ticketOptions.locations.map((location) => ({
        value: location.id,
        label: location.name,
        clientId: location.client_id ?? null,
      }));
    default:
      return [];
  }
};

const mapWorkflowPickerOptions = (
  kind: string,
  data: WorkflowPickerData
): WorkflowPickerOption[] => {
  switch (kind) {
    case 'project':
      return data.projects.map((project) => ({
        value: project.project_id,
        label: project.project_name,
      }));
    case 'project-phase':
      return data.projects.flatMap((project) =>
        (project.phases ?? []).map((phase) => ({
          value: phase.phase_id,
          label: `${project.project_name} · ${phase.phase_name}`,
          projectId: project.project_id,
        }))
      );
    case 'project-task':
      return data.projectTasks.map((task) => ({
        value: task.task_id,
        label: task.task_name,
        phaseId: task.phase_id ?? null,
      }));
    case 'project-task-status':
      return data.projectStatuses.map((status) => ({
        value: status.mapping_id,
        label: status.name,
        projectId: status.project_id,
        phaseId: status.phase_id ?? null,
      }));
    case 'contact':
      return data.contacts.map((contact) => ({
        value: contact.contact_name_id,
        label: contact.email ? `${contact.full_name} (${contact.email})` : contact.full_name,
        clientId: contact.client_id ?? null,
      }));
    case 'user':
      return data.users.map((user) => ({
        value: user.user_id,
        label: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
      }));
    case 'user-or-team':
      return [
        ...data.users.map((user) => ({
          value: user.user_id,
          label: `User: ${`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username}`,
          assigneeType: 'user' as const,
        })),
        ...data.teams.map((team) => ({
          value: team.team_id,
          label: `Team: ${team.team_name}`,
          assigneeType: 'team' as const,
        })),
      ];
    case 'ticket':
      return data.tickets.map((ticket) => ({
        value: ticket.ticket_id,
        label: ticket.ticket_number ? `${ticket.ticket_number} · ${ticket.title ?? ticket.ticket_id}` : (ticket.title ?? ticket.ticket_id),
      }));
    default:
      return mapTicketFieldOptions(kind, data.ticketOptions);
  }
};

const filterWorkflowPickerOptions = (
  kind: string,
  options: WorkflowPickerOption[],
  dependencies: DependencyResolution[]
): WorkflowPickerOption[] => {
  const dependencyValues = new Map(
    dependencies
      .filter((dependency) => dependency.status === 'fixed' && dependency.value)
      .map((dependency) => [dependency.path, dependency.value as string])
  );

  switch (kind) {
    case 'contact': {
      const clientId = dependencyValues.get('client_id');
      return clientId
        ? options.filter((option) => option.clientId === clientId)
        : options;
    }
    case 'client-location': {
      const clientId = dependencyValues.get('client_id');
      return clientId
        ? options.filter((option) => option.clientId === clientId)
        : options;
    }
    case 'ticket-category': {
      const boardId = dependencyValues.get('board_id');
      return options.filter(
        (option) =>
          option.parentId === null &&
          (boardId ? option.boardId === boardId : true)
      );
    }
    case 'ticket-subcategory': {
      const boardId = dependencyValues.get('board_id');
      const categoryId = dependencyValues.get('category_id');
      return options.filter(
        (option) =>
          option.parentId !== null &&
          (boardId ? option.boardId === boardId : true) &&
          (categoryId ? option.parentId === categoryId : true)
      );
    }
    case 'project-phase': {
      const projectId = dependencyValues.get('project_id') ?? dependencyValues.get('target_project_id') ?? dependencyValues.get('filters.project_id');
      return projectId ? options.filter((option) => option.projectId === projectId) : options;
    }
    case 'project-task': {
      const phaseId = dependencyValues.get('phase_id') ?? dependencyValues.get('target_phase_id') ?? dependencyValues.get('filters.phase_id');
      return phaseId ? options.filter((option) => option.phaseId === phaseId) : options;
    }
    case 'project-task-status': {
      const projectId = dependencyValues.get('project_id') ?? dependencyValues.get('target_project_id') ?? dependencyValues.get('filters.project_id');
      const phaseId = dependencyValues.get('phase_id') ?? dependencyValues.get('target_phase_id') ?? dependencyValues.get('filters.phase_id');
      return options.filter((option) =>
        (!projectId || option.projectId === projectId) &&
        (!phaseId || option.phaseId === phaseId || option.phaseId === null)
      );
    }
    case 'user-or-team': {
      const assigneeType = getAssignmentTypeDependencyValue(dependencyValues);
      if (assigneeType === 'user') {
        return options.filter((option) => option.assigneeType === 'user');
      }
      if (assigneeType === 'team' || assigneeType === 'queue') {
        return options.filter((option) => option.assigneeType === 'team');
      }
      return options;
    }
    default:
      return options;
  }
};

const appendCurrentValueOption = (
  options: WorkflowPickerOption[],
  currentValue: string | null
): WorkflowPickerOption[] => {
  if (!currentValue || options.some((option) => option.value === currentValue)) {
    return options;
  }

  return [
    ...options,
    {
      value: currentValue,
      label: currentValue,
    },
  ];
};

const getResolvedDependencyValueFromAny = (
  dependencies: DependencyResolution[],
  paths: string[]
): string | undefined => {
  for (const path of paths) {
    const value = getResolvedDependencyValue(dependencies, path);
    if (value) return value;
  }
  return undefined;
};

const loadWorkflowPickerData = async (
  kind: string,
  dependencies: DependencyResolution[]
): Promise<WorkflowPickerData> => {
  switch (kind) {
    case 'project': {
      const projects = await getProjectsWithPhases();
      return {
        ...EMPTY_PICKER_DATA,
        projects: isActionPermissionError(projects) ? [] : projects,
      };
    }
    case 'project-phase': {
      const projects = await getProjectsWithPhases();
      return {
        ...EMPTY_PICKER_DATA,
        projects: isActionPermissionError(projects) ? [] : projects,
      };
    }
    case 'project-task-status': {
      const projects = await getProjectsWithPhases();
      const safeProjects = isActionPermissionError(projects) ? [] : projects;
      return {
        ...EMPTY_PICKER_DATA,
        projects: safeProjects,
        projectStatuses: safeProjects.flatMap((project) =>
          (project.phases ?? []).flatMap((phase) =>
            (phase.statuses ?? []).map((status) => ({
              mapping_id: status.mapping_id,
              name: status.name,
              project_id: project.project_id,
              phase_id: phase.phase_id,
            }))
          )
        ),
      };
    }
    case 'project-task': {
      const projectId = getResolvedDependencyValueFromAny(dependencies, ['project_id', 'target_project_id', 'filters.project_id']);
      if (!projectId) return EMPTY_PICKER_DATA;
      const taskData = await getProjectTaskData(projectId);
      return {
        ...EMPTY_PICKER_DATA,
        projectTasks: isActionPermissionError(taskData) ? [] : taskData.tasks,
      };
    }
    case 'ticket-status': {
      const fixedBoard = dependencies.find((dependency) => dependency.path === 'board_id');
      const fixedTicket = dependencies.find((dependency) => dependency.path === 'ticket_id');
      let boardId: string | null = null;

      if (fixedBoard?.status === 'fixed' && fixedBoard.value) {
        boardId = fixedBoard.value;
      } else if (fixedTicket?.status === 'fixed' && fixedTicket.value) {
        const ticket = await getTicketById(fixedTicket.value);
        boardId = ticket?.board_id ?? null;
      }

      if (!boardId) {
        return {
          ...EMPTY_PICKER_DATA,
          ticketOptions: EMPTY_TICKET_FIELD_OPTIONS,
        };
      }

      const { statuses } = await getAvailableStatuses(boardId);
      return {
        ...EMPTY_PICKER_DATA,
        ticketOptions: {
          ...EMPTY_TICKET_FIELD_OPTIONS,
          statuses,
        },
      };
    }
    case 'contact': {
      const fixedClient = dependencies.find((dependency) => dependency.path === 'client_id');
      const contacts = fixedClient?.status === 'fixed' && fixedClient.value
        ? await getContactsByClient(fixedClient.value)
        : await getAllContacts();
      return {
        ...EMPTY_PICKER_DATA,
        contacts,
      };
    }
    case 'user':
      return {
        ...EMPTY_PICKER_DATA,
        users: await getAllUsersBasic(true, 'internal'),
      };
    case 'user-or-team': {
      const [users, teams] = await Promise.all([
        getAllUsersBasic(true, 'internal'),
        getTeamsBasic(),
      ]);

      return {
        ...EMPTY_PICKER_DATA,
        users,
        teams: teams.map((team) => ({
          ...team,
          members: [],
        })),
      };
    }
    default:
      return {
        ...EMPTY_PICKER_DATA,
        ticketOptions: (await getTicketFieldOptions()).options,
      };
  }
};

const WorkflowTicketPicker: React.FC<{
  field: WorkflowActionInputPickerField;
  value: string | null;
  onChange: (value: string | null) => void;
  idPrefix: string;
  disabled?: boolean;
}> = ({ field, value, onChange, idPrefix, disabled }) => {
  const { t } = useTranslation('msp/workflows');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<WorkflowPickerOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const normalizedSearch = search.trim();

    const loadOptions = async () => {
      if (!normalizedSearch) {
        if (value) {
          try {
            setIsLoading(true);
            setLoadError(null);
            const ticket = await getTicketById(value);
            if (!active) return;
            setOptions(ticket ? [{
              value: ticket.ticket_id,
              label: ticket.ticket_number ? `${ticket.ticket_number} · ${ticket.title ?? ticket.ticket_id}` : (ticket.title ?? ticket.ticket_id),
            }] : []);
          } catch (error) {
            if (!active) return;
            console.error('Failed to load selected workflow ticket picker value:', error);
            setOptions(value ? [{ value, label: value }] : []);
            setLoadError(error instanceof Error ? error.message : t('actionInputFixedPicker.errors.loadTicket', { defaultValue: 'Failed to load ticket' }));
          } finally {
            if (active) {
              setIsLoading(false);
            }
          }
          return;
        }

        setOptions([]);
        setLoadError(null);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setLoadError(null);
        const result = await getTicketsForList({
          boardFilterState: 'active',
          searchQuery: normalizedSearch,
        });
        if (!active) return;
        const mapped = ((result as { tickets?: WorkflowTicketSearchResult[] } | null)?.tickets ?? [])
          .slice(0, 25)
          .map((ticket) => ({
            value: ticket.ticket_id,
            label: ticket.ticket_number ? `${ticket.ticket_number} · ${ticket.title ?? ticket.ticket_id}` : (ticket.title ?? ticket.ticket_id),
          }));
        setOptions(appendCurrentValueOption(mapped, value));
      } catch (error) {
        if (!active) return;
        console.error('Failed to search tickets for workflow picker:', error);
        setOptions(appendCurrentValueOption([], value));
        setLoadError(error instanceof Error ? error.message : t('actionInputFixedPicker.errors.searchTickets', { defaultValue: 'Failed to search tickets' }));
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    const timeoutId = window.setTimeout(() => {
      void loadOptions();
    }, normalizedSearch ? 200 : 0);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [search, value, t]);

  const placeholder = field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? t('actionInputFixedPicker.ticketSearchPlaceholder', { defaultValue: 'Search tickets by number or title' });

  return (
    <div className="space-y-2">
      <Input
        id={`${idPrefix}-literal-ticket-search`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <CustomSelect
        id={`${idPrefix}-literal-picker`}
        options={options}
        value={value ?? ''}
        onValueChange={(nextValue) => onChange(nextValue || null)}
        placeholder={search.trim().length > 0
          ? t('actionInputFixedPicker.ticketSelect', { defaultValue: 'Select ticket' })
          : t('actionInputFixedPicker.ticketTypeAbove', { defaultValue: 'Type above to search tickets' })}
        disabled={disabled || isLoading || (search.trim().length === 0 && !value)}
      />
      {loadError && (
        <p className="text-[11px] text-gray-500">{loadError}</p>
      )}
    </div>
  );
};

const renderDedicatedPicker = ({
  t,
  field,
  pickerKind,
  data,
  dependencyResolutions,
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  t: TFunction;
  field: WorkflowActionInputPickerField;
  pickerKind: string;
  data: WorkflowPickerData;
  dependencyResolutions: DependencyResolution[];
  value: string | null;
  onChange: (value: string | null) => void;
  idPrefix: string;
  disabled?: boolean;
}): React.ReactNode => {
  switch (pickerKind) {
    case 'board': {
      const boards = toBoards(data.ticketOptions);
      return (
        <BoardPicker
          id={`${idPrefix}-literal-picker`}
          boards={boards}
          selectedBoardId={value}
          onSelect={(nextValue) => onChange(nextValue)}
          filterState="active"
          onFilterStateChange={() => {}}
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? t('actionInputFixedPicker.placeholders.board', { defaultValue: 'Select Board' })}
        />
      );
    }
    case 'client': {
      const clients = toClients(data.ticketOptions);
      return (
        <ClientPicker
          id={`${idPrefix}-literal-picker`}
          clients={clients}
          selectedClientId={value}
          onSelect={(nextValue) => onChange(nextValue)}
          filterState="active"
          onFilterStateChange={() => {}}
          clientTypeFilter="all"
          onClientTypeFilterChange={() => {}}
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? t('actionInputFixedPicker.placeholders.client', { defaultValue: 'Select Client' })}
        />
      );
    }
    case 'contact':
      return (
        <ContactPicker
          id={`${idPrefix}-literal-picker`}
          contacts={data.contacts}
          value={value ?? ''}
          onValueChange={(nextValue) => onChange(nextValue || null)}
          clientId={getResolvedDependencyValue(dependencyResolutions, 'client_id')}
          label={field.name.replace(/_/g, ' ')}
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? t('actionInputFixedPicker.placeholders.contact', { defaultValue: 'Select Contact' })}
        />
      );
    case 'user':
      return (
        <UserPicker
          id={`${idPrefix}-literal-picker`}
          label={field.name.replace(/_/g, ' ')}
          value={value ?? ''}
          onValueChange={(nextValue) => onChange(nextValue || null)}
          users={data.users}
          userTypeFilter="internal"
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? t('actionInputFixedPicker.placeholders.user', { defaultValue: 'Select User' })}
          buttonWidth="full"
        />
      );
    case 'user-or-team': {
      const dependencyValues = new Map(
        dependencyResolutions
          .filter((dependency) => dependency.status === 'fixed' && dependency.value)
          .map((dependency) => [dependency.path, dependency.value as string])
      );
      const assigneeType = getAssignmentTypeDependencyValue(dependencyValues);
      const filteredUsers = assigneeType === 'team' || assigneeType === 'queue' ? [] : data.users;
      const filteredTeams = assigneeType === 'user' ? [] : data.teams;

      return (
        <UserAndTeamPicker
          id={`${idPrefix}-literal-picker`}
          label={field.name.replace(/_/g, ' ')}
          value={value ?? ''}
          onValueChange={(nextValue) => onChange(nextValue || null)}
          onTeamSelect={(teamId) => onChange(teamId)}
          users={filteredUsers}
          teams={filteredTeams}
          userTypeFilter="internal"
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? t('actionInputFixedPicker.placeholders.userOrTeam', { defaultValue: 'Select User or Team' })}
          buttonWidth="full"
        />
      );
    }
    case 'ticket':
      return (
        <WorkflowTicketPicker
          field={field}
          value={value}
          onChange={onChange}
          idPrefix={idPrefix}
          disabled={disabled}
        />
      );
    default:
      return null;
  }
};

const getResolvedDependencyValue = (
  dependencies: DependencyResolution[],
  path: string
): string | undefined => dependencies.find((dependency) => dependency.path === path && dependency.status === 'fixed')?.value;

export const WorkflowActionInputFixedMultiPicker: React.FC<{
  field: WorkflowActionInputPickerField;
  values: string[];
  onChange: (values: string[]) => void;
  idPrefix: string;
  rootInputMapping: InputMapping;
  disabled?: boolean;
}> = ({
  field,
  values,
  onChange,
  idPrefix,
  rootInputMapping,
  disabled,
}) => {
  const { t } = useTranslation('msp/workflows');
  const [data, setData] = useState<WorkflowPickerData>(EMPTY_PICKER_DATA);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const pickerKind = field.editor?.picker?.resource ?? field.picker?.kind;
  const dependencyResolutions = useMemo(
    () =>
      (field.editor?.dependencies ?? field.picker?.dependencies ?? []).map((dependency) =>
        resolveDependency(rootInputMapping, dependency)
      ),
    [field.editor?.dependencies, field.picker?.dependencies, rootInputMapping]
  );
  const disabledExplanation = useMemo(
    () => (pickerKind ? buildDisabledExplanation(t, pickerKind, dependencyResolutions) : undefined),
    [dependencyResolutions, pickerKind, t]
  );
  const dependencySignature = useMemo(
    () => JSON.stringify(dependencyResolutions),
    [dependencyResolutions]
  );

  useEffect(() => {
    if (pickerKind !== 'user') {
      setData(EMPTY_PICKER_DATA);
      setLoadError(null);
      return;
    }

    if (disabledExplanation) {
      setData(EMPTY_PICKER_DATA);
      setLoadError(null);
      return;
    }

    let active = true;
    setIsLoading(true);
    setLoadError(null);

    loadWorkflowPickerData(pickerKind, dependencyResolutions)
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load workflow multi-picker options:', error);
        setData(EMPTY_PICKER_DATA);
        setLoadError(error instanceof Error ? error.message : 'Failed to load options');
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [dependencyResolutions, dependencySignature, disabledExplanation, pickerKind]);

  if (pickerKind !== 'user') {
    return null;
  }

  return (
    <div className="space-y-2">
      <MultiUserAndTeamPicker
        id={`${idPrefix}-literal-picker`}
        label={field.name.replace(/_/g, ' ')}
        values={values}
        onValuesChange={onChange}
        users={data.users}
        getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
        loading={isLoading}
        error={loadError}
        disabled={disabled || Boolean(disabledExplanation) || Boolean(loadError)}
        placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? 'Select Users'}
      />
      {(disabledExplanation || loadError) && (
        <p className="text-[11px] text-gray-500">
          {disabledExplanation ?? loadError}
        </p>
      )}
    </div>
  );
};

export const WorkflowActionInputFixedPicker: React.FC<{
  field: WorkflowActionInputPickerField;
  value: string | null;
  onChange: (value: string | null) => void;
  idPrefix: string;
  rootInputMapping: InputMapping;
  disabled?: boolean;
}> = ({
  field,
  value,
  onChange,
  idPrefix,
  rootInputMapping,
  disabled,
}) => {
  const { t } = useTranslation('msp/workflows');
  const [data, setData] = useState<WorkflowPickerData>(EMPTY_PICKER_DATA);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedDependencySignature, setLoadedDependencySignature] = useState<string | null>(null);

  const pickerKind = field.editor?.picker?.resource ?? field.picker?.kind;
  const dependencyResolutions = useMemo(
    () =>
      (field.editor?.dependencies ?? field.picker?.dependencies ?? []).map((dependency) =>
        resolveDependency(rootInputMapping, dependency)
      ),
    [field.editor?.dependencies, field.picker?.dependencies, rootInputMapping]
  );
  const disabledExplanation = useMemo(
    () => (pickerKind ? buildDisabledExplanation(t, pickerKind, dependencyResolutions) : undefined),
    [dependencyResolutions, pickerKind, t]
  );
  const dependencySignature = useMemo(
    () => JSON.stringify(dependencyResolutions),
    [dependencyResolutions]
  );
  const baseOptions = useMemo(() => {
    if (!pickerKind) return [];
    return mapWorkflowPickerOptions(pickerKind, data);
  }, [data, pickerKind]);
  const filteredOptions = useMemo(() => {
    if (!pickerKind) return [];
    return filterWorkflowPickerOptions(pickerKind, baseOptions, dependencyResolutions);
  }, [baseOptions, dependencyResolutions, pickerKind]);
  const pickerOptions = useMemo(() => {
    return appendCurrentValueOption(filteredOptions, value);
  }, [filteredOptions, value]);
  const hasResolvedDependencies = useMemo(
    () =>
      dependencyResolutions.length > 0 &&
      dependencyResolutions.every((dependency) => dependency.status === 'fixed'),
    [dependencyResolutions]
  );
  const hasDedicatedPicker = pickerKind ? DEDICATED_PICKER_KINDS.has(pickerKind) : false;

  useEffect(() => {
    if (!pickerKind || pickerKind === 'ticket') {
      setData(EMPTY_PICKER_DATA);
      setLoadError(null);
      setLoadedDependencySignature(null);
      return;
    }

    if (disabledExplanation) {
      setData(EMPTY_PICKER_DATA);
      setLoadError(null);
      setLoadedDependencySignature(null);
      return;
    }

    let active = true;
    setIsLoading(true);
    setLoadError(null);
    setLoadedDependencySignature(null);

    loadWorkflowPickerData(pickerKind, dependencyResolutions)
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setLoadedDependencySignature(dependencySignature);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load workflow picker options:', error);
        setData(EMPTY_PICKER_DATA);
        setLoadError(error instanceof Error ? error.message : t('actionInputFixedPicker.errors.loadOptions', { defaultValue: 'Failed to load options' }));
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [dependencyResolutions, dependencySignature, disabledExplanation, pickerKind, t]);

  useEffect(() => {
    if (!hasResolvedDependencies || !value || loadedDependencySignature !== dependencySignature) {
      return;
    }

    const stillValid = filteredOptions.some((option) => option.value === value);
    if (!stillValid) {
      onChange(null);
    }
  }, [dependencySignature, filteredOptions, hasResolvedDependencies, loadedDependencySignature, onChange, value]);

  if (!pickerKind) {
    return null;
  }

  const shouldRenderFallback =
    disabled ||
    isLoading ||
    Boolean(disabledExplanation) ||
    Boolean(loadError) ||
    !hasDedicatedPicker;

  return (
    <div className="space-y-2">
      {shouldRenderFallback ? (
        <CustomSelect
          id={`${idPrefix}-literal-picker`}
          options={pickerOptions}
          value={value ?? ''}
          onValueChange={(nextValue) => onChange(nextValue || null)}
          placeholder={getWorkflowPickerPlaceholder(t, field, isLoading, disabledExplanation)}
          disabled={disabled || isLoading || Boolean(disabledExplanation) || Boolean(loadError)}
        />
      ) : (
        renderDedicatedPicker({
          t,
          field,
          pickerKind,
          data,
          dependencyResolutions,
          value,
          onChange,
          idPrefix,
          disabled,
        })
      )}
      {(disabledExplanation || loadError) && (
        <p className="text-[11px] text-gray-500">
          {disabledExplanation ?? loadError}
        </p>
      )}
    </div>
  );
};

export default WorkflowActionInputFixedPicker;
