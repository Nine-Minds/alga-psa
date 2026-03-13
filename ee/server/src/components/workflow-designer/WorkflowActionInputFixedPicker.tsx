'use client';

import React, { useEffect, useMemo, useState } from 'react';

import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getAllContacts, getContactsByClient } from '@alga-psa/clients/actions';
import { getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { getTeamsBasic } from '@alga-psa/teams/actions';
import type { InputMapping, MappingValue } from '@shared/workflow/runtime/client';

export type WorkflowActionInputPickerField = {
  name: string;
  nullable?: boolean;
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
  'ticket-subcategory': {
    board_id: 'Choose a fixed Board first to load subcategory options.',
    category_id: 'Choose a fixed Category first to load subcategory options.',
  },
};

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

const mapTicketFieldOptions = async (kind: string): Promise<WorkflowPickerOption[]> => {
  const { options } = await getTicketFieldOptions();

  switch (kind) {
    case 'board':
      return options.boards.map((board) => ({
        value: board.id,
        label: board.name,
      }));
    case 'client':
      return options.clients.map((client) => ({
        value: client.id,
        label: client.name,
      }));
    case 'ticket-status':
      return options.statuses.map((status) => ({
        value: status.id,
        label: status.name,
      }));
    case 'ticket-priority':
      return options.priorities.map((priority) => ({
        value: priority.id,
        label: priority.name,
      }));
    case 'user':
      return options.users.map((user) => ({
        value: user.id,
        label: user.name,
      }));
    case 'ticket-category':
    case 'ticket-subcategory':
      return options.categories.map((category) => ({
        value: category.id,
        label: category.name,
        boardId: category.board_id ?? null,
        parentId: category.parent_id ?? null,
      }));
    case 'client-location':
      return options.locations.map((location) => ({
        value: location.id,
        label: location.name,
        clientId: location.client_id ?? null,
      }));
    default:
      return [];
  }
};

const loadWorkflowPickerOptions = async (
  kind: string,
  dependencies: DependencyResolution[]
): Promise<WorkflowPickerOption[]> => {
  switch (kind) {
    case 'contact': {
      const fixedClient = dependencies.find((dependency) => dependency.path === 'client_id');
      const contacts = fixedClient?.status === 'fixed' && fixedClient.value
        ? await getContactsByClient(fixedClient.value)
        : await getAllContacts();

      return contacts.map((contact) => ({
        value: contact.contact_name_id,
        label: contact.email ? `${contact.full_name} (${contact.email})` : contact.full_name,
        clientId: contact.client_id ?? null,
      }));
    }
    case 'user-or-team': {
      const [users, teams] = await Promise.all([
        mapTicketFieldOptions('user'),
        getTeamsBasic(),
      ]);

      return [
        ...users.map((user) => ({
          ...user,
          label: `User: ${user.label}`,
          assigneeType: 'user' as const,
        })),
        ...teams.map((team) => ({
          value: team.team_id,
          label: `Team: ${team.team_name}`,
          assigneeType: 'team' as const,
        })),
      ];
    }
    default:
      return mapTicketFieldOptions(kind);
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

const buildDisabledExplanation = (
  kind: string,
  dependencies: DependencyResolution[]
): string | undefined => {
  const hints = TICKET_PICKER_DEPENDENCY_HINTS[kind];
  if (!hints) return undefined;

  const unresolved = dependencies.find((dependency) => dependency.status !== 'fixed' && hints[dependency.path]);
  return unresolved ? hints[unresolved.path] : undefined;
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

  const hint = field.picker?.fixedValueHint?.trim();
  if (hint) {
    return hint;
  }

  return `Select ${field.name.replace(/_/g, ' ')}`;
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
  const [options, setOptions] = useState<WorkflowPickerOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const pickerKind = field.picker?.kind;
  const dependencyResolutions = useMemo(
    () => (field.picker?.dependencies ?? []).map((dependency) => resolveDependency(rootInputMapping, dependency)),
    [field.picker?.dependencies, rootInputMapping]
  );
  const disabledExplanation = useMemo(
    () => (pickerKind ? buildDisabledExplanation(pickerKind, dependencyResolutions) : undefined),
    [dependencyResolutions, pickerKind]
  );
  const pickerOptions = useMemo(() => {
    if (!pickerKind) return [];
    const filtered = filterWorkflowPickerOptions(pickerKind, options, dependencyResolutions);
    return appendCurrentValueOption(filtered, value);
  }, [dependencyResolutions, options, pickerKind, value]);

  useEffect(() => {
    if (!pickerKind) {
      setOptions([]);
      setLoadError(null);
      return;
    }

    const shouldSkipLoad = Boolean(disabledExplanation);
    if (shouldSkipLoad) {
      setOptions([]);
      setLoadError(null);
      return;
    }

    let active = true;
    setIsLoading(true);
    setLoadError(null);

    loadWorkflowPickerOptions(pickerKind, dependencyResolutions)
      .then((nextOptions) => {
        if (!active) return;
        setOptions(nextOptions);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to load workflow picker options:', error);
        setOptions([]);
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
  }, [dependencyResolutions, disabledExplanation, pickerKind]);

  if (!pickerKind) {
    return null;
  }

  return (
    <div className="space-y-2">
      <CustomSelect
        id={`${idPrefix}-literal-picker`}
        options={pickerOptions}
        value={value ?? ''}
        onValueChange={(nextValue) => onChange(nextValue || null)}
        placeholder={getWorkflowPickerPlaceholder(field, isLoading, disabledExplanation)}
        disabled={disabled || isLoading || Boolean(disabledExplanation)}
      />
      {(disabledExplanation || loadError) && (
        <p className="text-[11px] text-gray-500">
          {disabledExplanation ?? loadError}
        </p>
      )}
    </div>
  );
};

export default WorkflowActionInputFixedPicker;
