'use client';

import React, { useEffect, useMemo, useState } from 'react';

import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { getAllContacts, getContactsByClient } from '@alga-psa/clients/actions';
import { getAvailableStatuses, getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { getAllUsersBasic, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeamAvatarUrlsBatchAction, getTeamsBasic } from '@alga-psa/teams/actions';
import { getTicketById, getTicketsForList } from '@alga-psa/tickets/actions';
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
  assigneeType?: 'user' | 'team';
};

type WorkflowTicketSearchResult = {
  ticket_id: string;
  ticket_number?: string | null;
  title?: string | null;
  status_name?: string | null;
};

type WorkflowPickerData = {
  ticketOptions: TicketFieldOptions | null;
  contacts: IContact[];
  users: IUser[];
  teams: ITeam[];
  tickets: WorkflowTicketSearchResult[];
};

const EMPTY_PICKER_DATA: WorkflowPickerData = {
  ticketOptions: null,
  contacts: [],
  users: [],
  teams: [],
  tickets: [],
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

const TICKET_PICKER_DEPENDENCY_HINTS: Partial<Record<string, Record<string, string>>> = {
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
};

export const WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES = new Set([
  'board',
  'client',
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
  kind: string,
  dependencies: DependencyResolution[]
): string | undefined => {
  const hints = TICKET_PICKER_DEPENDENCY_HINTS[kind];
  if (!hints) return undefined;

  const unresolved = dependencies.find((dependency) => dependency.status !== 'fixed' && hints[dependency.path]);
  return unresolved ? hints[unresolved.path] : undefined;
};

const getWorkflowPickerPlaceholder = (
  field: WorkflowActionInputPickerField,
  isLoading: boolean,
  explanation?: string
): string => {
  if (isLoading) {
    return 'Loading options...';
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
    case 'user-or-team': {
      const assigneeType = dependencyValues.get('assignee.type');
      return assigneeType === 'user' || assigneeType === 'team'
        ? options.filter((option) => option.assigneeType === assigneeType)
        : options;
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

const loadWorkflowPickerData = async (
  kind: string,
  dependencies: DependencyResolution[]
): Promise<WorkflowPickerData> => {
  switch (kind) {
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
            setOptions(ticket?.ticket_id ? ([{
              value: ticket.ticket_id,
              label: ticket.ticket_number ? `${ticket.ticket_number} · ${ticket.title ?? ticket.ticket_id}` : (ticket.title ?? ticket.ticket_id),
            }] satisfies WorkflowPickerOption[]) : []);
          } catch (error) {
            if (!active) return;
            console.error('Failed to load selected workflow ticket picker value:', error);
            setOptions(value ? ([{ value, label: value }] satisfies WorkflowPickerOption[]) : []);
            setLoadError(error instanceof Error ? error.message : 'Failed to load ticket');
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
        const mapped: WorkflowPickerOption[] = ((result as { tickets?: WorkflowTicketSearchResult[] } | null)?.tickets ?? [])
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
        setLoadError(error instanceof Error ? error.message : 'Failed to search tickets');
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
  }, [search, value]);

  const placeholder = field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? 'Search tickets by number or title';

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
        placeholder={search.trim().length > 0 ? 'Select ticket' : 'Type above to search tickets'}
        disabled={disabled || isLoading || (search.trim().length === 0 && !value)}
      />
      {loadError && (
        <p className="text-[11px] text-gray-500">{loadError}</p>
      )}
    </div>
  );
};

const renderDedicatedPicker = ({
  field,
  pickerKind,
  data,
  dependencyResolutions,
  value,
  onChange,
  idPrefix,
  disabled,
}: {
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
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? 'Select Board'}
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
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? 'Select Client'}
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
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? 'Select Contact'}
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
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? 'Select User'}
          buttonWidth="full"
        />
      );
    case 'user-or-team':
      return (
        <UserAndTeamPicker
          id={`${idPrefix}-literal-picker`}
          label={field.name.replace(/_/g, ' ')}
          value={value ?? ''}
          onValueChange={(nextValue) => onChange(nextValue || null)}
          onTeamSelect={(teamId) => onChange(teamId)}
          users={data.users}
          teams={data.teams}
          userTypeFilter="internal"
          getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
          getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
          placeholder={field.editor?.fixedValueHint?.trim() ?? field.picker?.fixedValueHint?.trim() ?? 'Select User or Team'}
          buttonWidth="full"
        />
      );
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
    () => (pickerKind ? buildDisabledExplanation(pickerKind, dependencyResolutions) : undefined),
    [dependencyResolutions, pickerKind]
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
          placeholder={getWorkflowPickerPlaceholder(field, isLoading, disabledExplanation)}
          disabled={disabled || isLoading || Boolean(disabledExplanation) || Boolean(loadError)}
        />
      ) : (
        renderDedicatedPicker({
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
