'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  addServiceRequestFormFieldAction,
  getServiceRequestDefinitionSubmissionDetailAction,
  getServiceRequestDefinitionEditorDataAction,
  getServiceRequestTicketRoutingBoardDataAction,
  getServiceRequestTicketRoutingReferenceDataAction,
  listServiceRequestDefinitionSubmissionsAction,
  publishServiceRequestDefinitionAction,
  removeServiceRequestFormFieldAction,
  reorderServiceRequestFormFieldsAction,
  saveServiceRequestDefinitionDraftAction,
  searchLinkedServicesForDefinitionAction,
  updateServiceRequestBasicsAction,
  updateServiceRequestFormBehaviorConfigAction,
  updateServiceRequestFormBehaviorProviderAction,
  updateServiceRequestFormFieldAction,
  updateServiceRequestExecutionConfigAction,
  setLinkedServiceForDefinitionAction,
  updateServiceRequestExecutionProviderAction,
  updateServiceRequestVisibilityConfigAction,
  updateServiceRequestVisibilityProviderAction,
  validateServiceRequestDefinitionForPublishAction,
} from './actions';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { toast } from 'react-hot-toast';
import { ServiceRequestCard } from '../../client-portal/request-services/ServiceRequestCard';
import { ServiceRequestIconPicker } from './ServiceRequestIconPicker';
import { SERVICE_REQUEST_ICON_OPTIONS } from '../../../lib/service-requests/iconCatalog';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { PrioritySelect } from '@alga-psa/ui/components/tickets/PrioritySelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { CategoryPicker } from '@alga-psa/tickets/components';
import { calculateItilPriority, ItilLabels } from '@alga-psa/tickets/lib/itilUtils';
import type { IBoard, IPriority, ITicketCategory, ITicketStatus, IUser } from '@alga-psa/types';

interface EditorData {
  definitionId: string;
  lifecycleState: 'draft' | 'published' | 'archived';
  basics: {
    name: string;
    description: string | null;
    icon: string | null;
    categoryId: string | null;
    categoryName: string | null;
    sortOrder: number;
    availableCategories: Array<{
      categoryId: string;
      categoryName: string;
    }>;
  };
  linkage: {
    linkedServiceId: string | null;
    linkedServiceName: string | null;
  };
  form: {
    schema: Record<string, unknown>;
  };
  execution: {
    executionProvider: string;
    executionConfig: Record<string, unknown>;
    formBehaviorProvider: string;
    formBehaviorConfig: Record<string, unknown>;
    visibilityProvider: string;
    visibilityConfig: Record<string, unknown>;
    availableExecutionProviders: Array<{
      key: string;
      displayName: string;
      executionMode: string;
    }>;
    availableFormBehaviorProviders: Array<{
      key: string;
      displayName: string;
    }>;
    availableVisibilityProviders: Array<{
      key: string;
      displayName: string;
    }>;
    showWorkflowExecutionConfigPanel: boolean;
    showAdvancedFormBehaviorConfigPanel: boolean;
  };
  publish: {
    publishedVersionNumber: number | null;
    publishedAt: string | Date | null;
    draftUpdatedAt: string | Date;
  };
}

interface DefinitionSubmissionRow {
  submission_id: string;
  request_name: string;
  requester_user_id: string | null;
  client_id: string;
  contact_id: string | null;
  execution_status: 'pending' | 'succeeded' | 'failed';
  created_ticket_id: string | null;
  workflow_execution_id: string | null;
  submitted_at: string | Date;
}

interface DefinitionSubmissionDetail extends DefinitionSubmissionRow {
  definition_id: string;
  definition_version_id: string;
  submitted_payload: Record<string, unknown>;
  execution_error_summary: string | null;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3 text-sm">
      <div className="font-medium text-[rgb(var(--color-text-700))]">{label}</div>
      <div className="text-[rgb(var(--color-text-900))] break-words">{value}</div>
    </div>
  );
}

interface FormFieldOption {
  label: string;
  value: string;
}

interface FormField {
  key: string;
  type: 'short-text' | 'long-text' | 'select' | 'checkbox' | 'date' | 'file-upload';
  label: string;
  helpText?: string | null;
  required?: boolean;
  defaultValue?: string | boolean | null;
  options?: FormFieldOption[];
}

interface TicketRoutingBoardConfig {
  category_type: 'custom' | 'itil';
  priority_type: 'custom' | 'itil';
  display_itil_impact?: boolean;
  display_itil_urgency?: boolean;
}

const FORM_FIELD_TYPES: Array<FormField['type']> = [
  'short-text',
  'long-text',
  'select',
  'checkbox',
  'date',
  'file-upload',
];

function getSchemaFields(schema: Record<string, unknown>): FormField[] {
  if (!Array.isArray((schema as any)?.fields)) {
    return [];
  }
  return (schema as any).fields.filter((field: unknown) => field && typeof field === 'object');
}

function parseSelectOptionsText(optionsText: string): FormFieldOption[] {
  return optionsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0 || separatorIndex >= line.length - 1) {
        return null;
      }
      const value = line.slice(0, separatorIndex).trim();
      const label = line.slice(separatorIndex + 1).trim();
      if (!value || !label) {
        return null;
      }
      return { value, label };
    })
    .filter((option): option is FormFieldOption => option !== null);
}

function formatSelectOptionsText(options: FormFieldOption[] | undefined): string {
  if (!Array.isArray(options) || options.length === 0) {
    return '';
  }
  return options.map((option) => `${option.value}:${option.label}`).join('\n');
}

function getSelectedIconLabel(iconValue: string): string {
  const match = SERVICE_REQUEST_ICON_OPTIONS.find((option) => option.value === iconValue);
  return match?.label ?? 'No icon selected';
}

function getDefaultStatus(statuses: ITicketStatus[]): ITicketStatus | null {
  const openStatuses = statuses.filter((status) => !status.is_closed);

  return (
    openStatuses.find((status) => Boolean((status as ITicketStatus & { is_default?: boolean }).is_default)) ||
    openStatuses[0] ||
    statuses.find((status) => Boolean((status as ITicketStatus & { is_default?: boolean }).is_default)) ||
    statuses[0] ||
    null
  );
}

function getDefaultPriorityId(
  priorities: IPriority[],
  priorityType?: 'custom' | 'itil'
): string {
  if (priorities.length === 0) {
    return '';
  }

  if (priorityType === 'itil') {
    const itilPriorities = priorities.filter((priority) => priority.is_from_itil_standard);
    const mediumPriority = itilPriorities.find((priority) => priority.itil_priority_level === 3);
    return mediumPriority?.priority_id ?? itilPriorities[0]?.priority_id ?? priorities[0]?.priority_id ?? '';
  }

  const customPriorities = priorities.filter((priority) => !priority.is_from_itil_standard);
  return customPriorities[0]?.priority_id ?? priorities[0]?.priority_id ?? '';
}

function deriveSelectedRoutingCategories(config: {
  categoryId: string;
  subcategoryId: string;
}): string[] {
  if (config.subcategoryId) {
    return [config.subcategoryId];
  }
  if (config.categoryId) {
    return [config.categoryId];
  }
  return [];
}

const ITIL_IMPACT_OPTIONS: SelectOption[] = [
  { value: '1', label: '1 - High (Critical business function affected)' },
  { value: '2', label: '2 - Medium-High (Important function affected)' },
  { value: '3', label: '3 - Medium (Minor function affected)' },
  { value: '4', label: '4 - Medium-Low (Minimal impact)' },
  { value: '5', label: '5 - Low (No business impact)' },
];

const ITIL_URGENCY_OPTIONS: SelectOption[] = [
  { value: '1', label: '1 - High (Work cannot continue)' },
  { value: '2', label: '2 - Medium-High (Work severely impaired)' },
  { value: '3', label: '3 - Medium (Work continues with limitations)' },
  { value: '4', label: '4 - Medium-Low (Minor inconvenience)' },
  { value: '5', label: '5 - Low (Work continues normally)' },
];

export default function ServiceRequestDefinitionEditorPage() {
  const params = useParams();
  const definitionId = String(params?.definitionId ?? '');
  const [data, setData] = useState<EditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [linkedServiceQuery, setLinkedServiceQuery] = useState('');
  const [linkedServiceResults, setLinkedServiceResults] = useState<
    Array<{ service_id: string; service_name: string; description: string | null }>
  >([]);
  const [submissions, setSubmissions] = useState<DefinitionSubmissionRow[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [selectedSubmissionDetail, setSelectedSubmissionDetail] = useState<DefinitionSubmissionDetail | null>(null);
  const [workflowIdInput, setWorkflowIdInput] = useState('');
  const [workflowInputMappingText, setWorkflowInputMappingText] = useState('{}');
  const [basicsInput, setBasicsInput] = useState({
    name: '',
    description: '',
    icon: '',
    categoryId: '',
    sortOrder: '0',
  });
  const [formBehaviorProviderInput, setFormBehaviorProviderInput] = useState('basic');
  const [formBehaviorConfigText, setFormBehaviorConfigText] = useState('{}');
  const [visibilityProviderInput, setVisibilityProviderInput] = useState(
    'all-authenticated-client-users'
  );
  const [visibilityConfigText, setVisibilityConfigText] = useState('{}');
  const [ticketRoutingConfigInput, setTicketRoutingConfigInput] = useState({
    boardId: '',
    statusId: '',
    priorityId: '',
    categoryId: '',
    subcategoryId: '',
    assignedToUserId: '',
    itilImpact: '',
    itilUrgency: '',
    titleFieldKey: '',
    descriptionPrefix: '',
  });
  const [ticketRoutingBoards, setTicketRoutingBoards] = useState<IBoard[]>([]);
  const [ticketRoutingPriorities, setTicketRoutingPriorities] = useState<IPriority[]>([]);
  const [ticketRoutingUsers, setTicketRoutingUsers] = useState<IUser[]>([]);
  const [ticketRoutingStatuses, setTicketRoutingStatuses] = useState<ITicketStatus[]>([]);
  const [ticketRoutingCategories, setTicketRoutingCategories] = useState<ITicketCategory[]>([]);
  const [ticketRoutingBoardConfig, setTicketRoutingBoardConfig] = useState<TicketRoutingBoardConfig | null>(null);
  const [ticketRoutingBoardFilterState, setTicketRoutingBoardFilterState] = useState<'active' | 'inactive' | 'all'>('active');
  const [ticketRoutingSelectedCategories, setTicketRoutingSelectedCategories] = useState<string[]>([]);
  const [ticketRoutingLoading, setTicketRoutingLoading] = useState(false);
  const [newFieldType, setNewFieldType] = useState<FormField['type']>('short-text');

  const isWorkflowBackedExecution = data?.execution.showWorkflowExecutionConfigPanel === true;
  const isTicketOnlyExecution = data?.execution.executionProvider === 'ticket-only';
  const hasLivePublishedVersion = Boolean(data?.publish.publishedVersionNumber);
  const draftLifecycleLabel =
    data?.lifecycleState === 'draft' && hasLivePublishedVersion ? 'draft changes' : data?.lifecycleState;
  const calculatedItilPriority = useMemo(() => {
    const impact = Number.parseInt(ticketRoutingConfigInput.itilImpact, 10);
    const urgency = Number.parseInt(ticketRoutingConfigInput.itilUrgency, 10);
    if (!Number.isInteger(impact) || !Number.isInteger(urgency)) {
      return null;
    }

    try {
      return calculateItilPriority(impact, urgency);
    } catch {
      return null;
    }
  }, [ticketRoutingConfigInput.itilImpact, ticketRoutingConfigInput.itilUrgency]);
  const ticketStatusOptions = useMemo<SelectOption[]>(
    () =>
      ticketRoutingStatuses.map((status) => ({
        value: status.status_id,
        label: status.name,
      })),
    [ticketRoutingStatuses]
  );
  const ticketPriorityOptions = useMemo(
    () =>
      ticketRoutingPriorities.map((priority) => ({
        value: priority.priority_id,
        label: priority.priority_name,
        color: priority.color ?? undefined,
        is_from_itil_standard: priority.is_from_itil_standard ?? undefined,
        itil_priority_level: priority.itil_priority_level ?? undefined,
      })),
    [ticketRoutingPriorities]
  );

  const loadTicketRoutingReferenceData = async (boardId?: string) => {
    const referenceData = await getServiceRequestTicketRoutingReferenceDataAction();
    setTicketRoutingBoards(referenceData.boards as IBoard[]);
    setTicketRoutingPriorities(referenceData.priorities as IPriority[]);
    setTicketRoutingUsers(referenceData.users as IUser[]);

    const nextBoardId = boardId?.trim() ?? '';
    if (nextBoardId.length === 0) {
      setTicketRoutingStatuses([]);
      setTicketRoutingCategories([]);
      setTicketRoutingBoardConfig(null);
      return;
    }

    setTicketRoutingLoading(true);
    try {
      const boardData = await getServiceRequestTicketRoutingBoardDataAction(nextBoardId);
      setTicketRoutingStatuses(boardData.statuses as ITicketStatus[]);
      setTicketRoutingCategories(boardData.categories as ITicketCategory[]);
      setTicketRoutingBoardConfig(
        (boardData.boardConfig as TicketRoutingBoardConfig | null) ?? null
      );
    } finally {
      setTicketRoutingLoading(false);
    }
  };

  const reloadDefinitionEditorState = async (
    targetDefinitionId: string,
    includeSubmissionDetail: boolean = false
  ) => {
    const refreshed = await getServiceRequestDefinitionEditorDataAction(targetDefinitionId);
    setData(refreshed as EditorData | null);
    const validation = await validateServiceRequestDefinitionForPublishAction(targetDefinitionId);
    setValidationErrors(validation.errors ?? []);

    if (refreshed) {
      const definitionSubmissions = await listServiceRequestDefinitionSubmissionsAction(targetDefinitionId);
      setSubmissions(definitionSubmissions as DefinitionSubmissionRow[]);

      if (includeSubmissionDetail && selectedSubmissionId) {
        const detail = await getServiceRequestDefinitionSubmissionDetailAction(
          targetDefinitionId,
          selectedSubmissionId
        );
        setSelectedSubmissionDetail(detail as DefinitionSubmissionDetail | null);
      }
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getServiceRequestDefinitionEditorDataAction(definitionId);
        setData(result as EditorData | null);
        if (result) {
          const definitionSubmissions = await listServiceRequestDefinitionSubmissionsAction(definitionId);
          setSubmissions(definitionSubmissions as DefinitionSubmissionRow[]);
          if (selectedSubmissionId) {
            const detail = await getServiceRequestDefinitionSubmissionDetailAction(
              definitionId,
              selectedSubmissionId
            );
            setSelectedSubmissionDetail(detail as DefinitionSubmissionDetail | null);
          }
          const validation = await validateServiceRequestDefinitionForPublishAction(definitionId);
          setValidationErrors(validation.errors ?? []);
        } else {
          setValidationErrors([]);
          setSubmissions([]);
          setSelectedSubmissionDetail(null);
        }
      } finally {
        setLoading(false);
      }
    };

    if (definitionId) {
      load();
    }
  }, [definitionId, selectedSubmissionId]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setBasicsInput({
      name: data.basics.name ?? '',
      description: data.basics.description ?? '',
      icon: data.basics.icon ?? '',
      categoryId: data.basics.categoryId ?? '',
      sortOrder: String(data.basics.sortOrder ?? 0),
    });
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const executionConfig = data.execution.executionConfig ?? {};
    const workflowId =
      typeof executionConfig.workflowId === 'string' ? executionConfig.workflowId : '';
    const inputMapping =
      executionConfig.inputMapping &&
      typeof executionConfig.inputMapping === 'object' &&
      !Array.isArray(executionConfig.inputMapping)
        ? executionConfig.inputMapping
        : {};

    setWorkflowIdInput(workflowId);
    setWorkflowInputMappingText(JSON.stringify(inputMapping, null, 2));
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const config = data.execution.executionConfig ?? {};
    const resolveConfigString = (key: string): string =>
      typeof config[key] === 'string' ? (config[key] as string) : '';
    const resolveConfigNumberString = (key: string): string => {
      const value = config[key];
      return typeof value === 'number' ? String(value) : resolveConfigString(key);
    };

    setTicketRoutingConfigInput({
      boardId: resolveConfigString('boardId'),
      statusId: resolveConfigString('statusId'),
      priorityId: resolveConfigString('priorityId'),
      categoryId: resolveConfigString('categoryId'),
      subcategoryId: resolveConfigString('subcategoryId'),
      assignedToUserId: resolveConfigString('assignedToUserId'),
      itilImpact: resolveConfigNumberString('itilImpact'),
      itilUrgency: resolveConfigNumberString('itilUrgency'),
      titleFieldKey: resolveConfigString('titleFieldKey'),
      descriptionPrefix: resolveConfigString('descriptionPrefix'),
    });
    setTicketRoutingSelectedCategories(
      deriveSelectedRoutingCategories({
        categoryId: resolveConfigString('categoryId'),
        subcategoryId: resolveConfigString('subcategoryId'),
      })
    );
    void loadTicketRoutingReferenceData(resolveConfigString('boardId'));
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setFormBehaviorProviderInput(data.execution.formBehaviorProvider);
    setFormBehaviorConfigText(
      JSON.stringify(data.execution.formBehaviorConfig ?? {}, null, 2)
    );
    setVisibilityProviderInput(data.execution.visibilityProvider);
    setVisibilityConfigText(
      JSON.stringify(data.execution.visibilityConfig ?? {}, null, 2)
    );
  }, [data]);

  const handleTicketRoutingBoardChange = async (nextBoardId: string) => {
    setTicketRoutingConfigInput((previous) => ({
      ...previous,
      boardId: nextBoardId,
      statusId: '',
      categoryId: '',
      subcategoryId: '',
      priorityId: '',
      itilImpact: '',
      itilUrgency: '',
      assignedToUserId: previous.assignedToUserId,
    }));
    setTicketRoutingSelectedCategories([]);

    if (!nextBoardId) {
      setTicketRoutingStatuses([]);
      setTicketRoutingCategories([]);
      setTicketRoutingBoardConfig(null);
      return;
    }

    setTicketRoutingLoading(true);
    try {
      const boardData = await getServiceRequestTicketRoutingBoardDataAction(nextBoardId);
      const nextStatuses = boardData.statuses as ITicketStatus[];
      const nextBoardConfig = (boardData.boardConfig as TicketRoutingBoardConfig | null) ?? null;
      setTicketRoutingStatuses(nextStatuses);
      setTicketRoutingCategories(boardData.categories as ITicketCategory[]);
      setTicketRoutingBoardConfig(nextBoardConfig);

      const defaultStatusId = getDefaultStatus(nextStatuses)?.status_id ?? '';
      const defaultPriorityId = getDefaultPriorityId(
        ticketRoutingPriorities,
        nextBoardConfig?.priority_type
      );
      const boardDefaultAssignee =
        ticketRoutingBoards.find((board) => board.board_id === nextBoardId)?.default_assigned_to ?? '';

      setTicketRoutingConfigInput((previous) => ({
        ...previous,
        boardId: nextBoardId,
        statusId: defaultStatusId,
        priorityId: defaultPriorityId,
        assignedToUserId: previous.assignedToUserId || boardDefaultAssignee || '',
        itilImpact: nextBoardConfig?.priority_type === 'itil' ? '3' : '',
        itilUrgency: nextBoardConfig?.priority_type === 'itil' ? '3' : '',
      }));
    } finally {
      setTicketRoutingLoading(false);
    }
  };

  const saveTicketRoutingConfig = async () => {
    if (!data) {
      return;
    }

    const selectedCategoryId = ticketRoutingSelectedCategories[0] ?? '';
    const selectedCategory = ticketRoutingCategories.find(
      (category) => category.category_id === selectedCategoryId
    );

    const nextExecutionConfig: Record<string, unknown> = {};
    const addStringConfig = (key: string, value: string) => {
      const trimmedValue = value.trim();
      if (trimmedValue.length > 0) {
        nextExecutionConfig[key] = trimmedValue;
      }
    };

    addStringConfig('boardId', ticketRoutingConfigInput.boardId);
    addStringConfig('statusId', ticketRoutingConfigInput.statusId);
    addStringConfig('priorityId', ticketRoutingConfigInput.priorityId);
    addStringConfig('assignedToUserId', ticketRoutingConfigInput.assignedToUserId);
    addStringConfig('titleFieldKey', ticketRoutingConfigInput.titleFieldKey);
    addStringConfig('descriptionPrefix', ticketRoutingConfigInput.descriptionPrefix);

    if (selectedCategory) {
      if (selectedCategory.parent_category) {
        nextExecutionConfig.categoryId = selectedCategory.parent_category;
        nextExecutionConfig.subcategoryId = selectedCategory.category_id;
      } else {
        nextExecutionConfig.categoryId = selectedCategory.category_id;
      }
    }

    const boardPriorityType = ticketRoutingBoardConfig?.priority_type;
    if (boardPriorityType === 'itil') {
      const impact = Number.parseInt(ticketRoutingConfigInput.itilImpact, 10);
      const urgency = Number.parseInt(ticketRoutingConfigInput.itilUrgency, 10);
      if (Number.isInteger(impact)) {
        nextExecutionConfig.itilImpact = impact;
      }
      if (Number.isInteger(urgency)) {
        nextExecutionConfig.itilUrgency = urgency;
      }
    }

    await updateServiceRequestExecutionConfigAction(data.definitionId, nextExecutionConfig);
    await reloadDefinitionEditorState(data.definitionId);
    toast.success('Ticket routing configuration updated');
  };

  if (loading) {
    return <div className="p-6 text-sm text-[rgb(var(--color-text-600))]">Loading definition editor…</div>;
  }

  if (!data) {
    return <div className="p-6 text-sm text-[rgb(var(--color-danger-600))]">Service request definition not found.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{data.basics.name}</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          Definition ID: {data.definitionId} · Current state: {draftLifecycleLabel}
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            id="service-request-editor-save-draft"
            variant="outline"
            onClick={async () => {
              try {
                await saveServiceRequestDefinitionDraftAction(data.definitionId);
                toast.success('Draft saved');
              } catch (error) {
                console.error('Failed to save draft', error);
                toast.error('Failed to save draft');
              }
            }}
          >
            {data.lifecycleState === 'published' ? 'Create Draft' : 'Save Draft'}
          </Button>
          <Button
            id="service-request-editor-publish"
            onClick={async () => {
              try {
                await publishServiceRequestDefinitionAction(data.definitionId);
                toast.success('Definition published');
                await reloadDefinitionEditorState(data.definitionId, true);
              } catch (error) {
                console.error('Failed to publish definition', error);
                toast.error(error instanceof Error ? error.message : 'Failed to publish definition');
              }
            }}
          >
            Publish
          </Button>
        </div>
      </div>

      <Card id="service-request-editor-basics" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Basics</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Name</span>
            <input
              id="service-request-basics-name"
              className="border rounded px-3 py-2 text-sm"
              value={basicsInput.name}
              onChange={(event) =>
                setBasicsInput((previous) => ({
                  ...previous,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="font-medium">Icon</span>
            <ServiceRequestIconPicker
              selectedIcon={basicsInput.icon}
              onChange={(icon) =>
                setBasicsInput((previous) => ({
                  ...previous,
                  icon,
                }))
              }
            />
            <span
              id="service-request-basics-icon"
              className="text-xs text-[rgb(var(--color-text-600))]"
            >
              Selected: {getSelectedIconLabel(basicsInput.icon)}
            </span>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="font-medium">Description</span>
            <textarea
              id="service-request-basics-description"
              className="border rounded px-3 py-2 text-sm min-h-[96px]"
              value={basicsInput.description}
              onChange={(event) =>
                setBasicsInput((previous) => ({
                  ...previous,
                  description: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Category</span>
            <select
              id="service-request-basics-category"
              className="border rounded px-3 py-2 text-sm"
              value={basicsInput.categoryId}
              onChange={(event) =>
                setBasicsInput((previous) => ({
                  ...previous,
                  categoryId: event.target.value,
                }))
              }
            >
              <option value="">Uncategorized</option>
              {data.basics.availableCategories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.categoryName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Sort Order</span>
            <input
              id="service-request-basics-sort-order"
              className="border rounded px-3 py-2 text-sm"
              type="number"
              value={basicsInput.sortOrder}
              onChange={(event) =>
                setBasicsInput((previous) => ({
                  ...previous,
                  sortOrder: event.target.value,
                }))
              }
            />
          </label>
        </div>
        <div>
          <Button
            id="service-request-basics-save"
            variant="outline"
            onClick={async () => {
              try {
                await updateServiceRequestBasicsAction(data.definitionId, {
                  name: basicsInput.name,
                  description:
                    basicsInput.description.trim().length > 0
                      ? basicsInput.description.trim()
                      : null,
                  icon: basicsInput.icon.trim().length > 0 ? basicsInput.icon.trim() : null,
                  categoryId:
                    basicsInput.categoryId.trim().length > 0
                      ? basicsInput.categoryId
                      : null,
                  sortOrder: Number.parseInt(basicsInput.sortOrder, 10) || 0,
                });
                await reloadDefinitionEditorState(data.definitionId);
                toast.success('Basics updated');
              } catch (error) {
                console.error('Failed to update basics', error);
                toast.error('Failed to update basics');
              }
            }}
          >
            Save Basics
          </Button>
        </div>
      </Card>

      <Card id="service-request-editor-service-preview" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Service Card Preview</h2>
        <ServiceRequestCard
          title={data.basics.name}
          description={data.basics.description}
          icon={data.basics.icon}
          categoryLabel={data.basics.categoryName ?? data.basics.categoryId ?? 'Uncategorized'}
        />
      </Card>

      <Card id="service-request-editor-linkage" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Linkage</h2>
        <FieldRow label="Linked Service" value={data.linkage.linkedServiceName ?? data.linkage.linkedServiceId ?? '-'} />
        <div className="flex gap-2">
          <input
            id="service-request-linked-service-search"
            className="border rounded px-3 py-2 text-sm flex-1"
            placeholder="Search service catalog"
            value={linkedServiceQuery}
            onChange={(event) => setLinkedServiceQuery(event.target.value)}
          />
          <Button
            id="service-request-linked-service-search-button"
            variant="outline"
            onClick={async () => {
              const results = await searchLinkedServicesForDefinitionAction(linkedServiceQuery);
              setLinkedServiceResults(results);
            }}
          >
            Search
          </Button>
          <Button
            id="service-request-linked-service-clear"
            variant="outline"
            onClick={async () => {
              await setLinkedServiceForDefinitionAction(data.definitionId, null);
              await reloadDefinitionEditorState(data.definitionId);
              toast.success('Linked service cleared');
            }}
          >
            Clear
          </Button>
        </div>
        {linkedServiceResults.length > 0 && (
          <ul className="space-y-2 text-sm">
            {linkedServiceResults.map((result) => (
              <li
                key={result.service_id}
                className="flex items-center justify-between border rounded p-2"
              >
                <div>
                  <div className="font-medium">{result.service_name}</div>
                  <div className="text-xs text-[rgb(var(--color-text-600))]">
                    {result.description ?? 'No description'}
                  </div>
                </div>
                <Button
                  id={`service-request-linked-service-select-${result.service_id}`}
                  variant="outline"
                  onClick={async () => {
                    await setLinkedServiceForDefinitionAction(data.definitionId, result.service_id);
                    await reloadDefinitionEditorState(data.definitionId);
                    toast.success(`Linked ${result.service_name}`);
                  }}
                >
                  Select
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="service-request-editor-form" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Form</h2>
        <div className="rounded border p-3 bg-[rgb(var(--color-background-100))] space-y-3">
          <div className="text-sm font-semibold">Author Fields</div>
          <div className="flex items-center gap-2">
            <select
              id="service-request-form-new-field-type"
              className="border rounded px-3 py-2 text-sm"
              value={newFieldType}
              onChange={(event) => setNewFieldType(event.target.value as FormField['type'])}
            >
              {FORM_FIELD_TYPES.map((fieldType) => (
                <option key={fieldType} value={fieldType}>
                  {fieldType}
                </option>
              ))}
            </select>
            <Button
              id="service-request-form-add-field"
              variant="outline"
              onClick={async () => {
                try {
                  await addServiceRequestFormFieldAction(data.definitionId, newFieldType);
                  await reloadDefinitionEditorState(data.definitionId);
                  toast.success('Field added');
                } catch (error) {
                  console.error('Failed to add form field', error);
                  toast.error('Failed to add form field');
                }
              }}
            >
              Add Field
            </Button>
          </div>
          <div className="space-y-3">
            {getSchemaFields(data.form.schema).length === 0 ? (
              <div className="text-sm text-[rgb(var(--color-text-600))]">No fields configured.</div>
            ) : (
              getSchemaFields(data.form.schema).map((field, index, allFields) => {
                const key = field.key ?? `field_${index}`;
                const optionsText = formatSelectOptionsText(field.options);
                return (
                  <div key={`${key}-${index}`} className="rounded border bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {field.type} · <span className="font-mono">{key}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          id={`service-request-form-move-up-${key}`}
                          variant="outline"
                          onClick={async () => {
                            const nextKeys = allFields.map((candidate) => candidate.key);
                            const currentIndex = nextKeys.indexOf(key);
                            if (currentIndex <= 0) {
                              return;
                            }
                            [nextKeys[currentIndex - 1], nextKeys[currentIndex]] = [
                              nextKeys[currentIndex],
                              nextKeys[currentIndex - 1],
                            ];
                            await reorderServiceRequestFormFieldsAction(data.definitionId, nextKeys);
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        >
                          Move Up
                        </Button>
                        <Button
                          id={`service-request-form-move-down-${key}`}
                          variant="outline"
                          onClick={async () => {
                            const nextKeys = allFields.map((candidate) => candidate.key);
                            const currentIndex = nextKeys.indexOf(key);
                            if (currentIndex < 0 || currentIndex >= nextKeys.length - 1) {
                              return;
                            }
                            [nextKeys[currentIndex], nextKeys[currentIndex + 1]] = [
                              nextKeys[currentIndex + 1],
                              nextKeys[currentIndex],
                            ];
                            await reorderServiceRequestFormFieldsAction(data.definitionId, nextKeys);
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        >
                          Move Down
                        </Button>
                        <Button
                          id={`service-request-form-remove-field-${key}`}
                          variant="outline"
                          onClick={async () => {
                            await removeServiceRequestFormFieldAction(data.definitionId, key);
                            await reloadDefinitionEditorState(data.definitionId);
                            toast.success('Field removed');
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium">Label</span>
                        <input
                          defaultValue={field.label ?? key}
                          className="border rounded px-2 py-1"
                          onBlur={async (event) => {
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              label: event.target.value.trim() || key,
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium">Help Text</span>
                        <input
                          defaultValue={field.helpText ?? ''}
                          className="border rounded px-2 py-1"
                          onBlur={async (event) => {
                            const value = event.target.value.trim();
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              helpText: value.length > 0 ? value : null,
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          defaultChecked={Boolean(field.required)}
                          onChange={async (event) => {
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              required: event.target.checked,
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                        <span>Required</span>
                      </label>
                      {field.type !== 'file-upload' && (
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium">Default Value</span>
                          {field.type === 'checkbox' ? (
                            <select
                              defaultValue={
                                typeof field.defaultValue === 'boolean'
                                  ? String(field.defaultValue)
                                  : ''
                              }
                              className="border rounded px-2 py-1"
                              onChange={async (event) => {
                                const value = event.target.value;
                                await updateServiceRequestFormFieldAction(data.definitionId, key, {
                                  defaultValue:
                                    value === ''
                                      ? null
                                      : value === 'true',
                                });
                                await reloadDefinitionEditorState(data.definitionId);
                              }}
                            >
                              <option value="">No default</option>
                              <option value="true">Checked</option>
                              <option value="false">Unchecked</option>
                            </select>
                          ) : (
                            <input
                              defaultValue={
                                typeof field.defaultValue === 'string' ? field.defaultValue : ''
                              }
                              className="border rounded px-2 py-1"
                              onBlur={async (event) => {
                                const value = event.target.value.trim();
                                await updateServiceRequestFormFieldAction(data.definitionId, key, {
                                  defaultValue: value.length > 0 ? value : null,
                                });
                                await reloadDefinitionEditorState(data.definitionId);
                              }}
                            />
                          )}
                        </label>
                      )}
                    </div>
                    {field.type === 'select' && (
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium">Options (one per line: value:label)</span>
                        <textarea
                          className="border rounded px-2 py-1 font-mono min-h-[84px]"
                          defaultValue={optionsText}
                          onBlur={async (event) => {
                            await updateServiceRequestFormFieldAction(data.definitionId, key, {
                              options: parseSelectOptionsText(event.target.value),
                            });
                            await reloadDefinitionEditorState(data.definitionId);
                          }}
                        />
                      </label>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="rounded border p-3 bg-[rgb(var(--color-background-100))]">
          <div className="text-sm font-medium mb-2">Rendered Form Preview</div>
          {getSchemaFields(data.form.schema).length > 0 ? (
            <form className="space-y-3">
              {getSchemaFields(data.form.schema).map((field, index) => {
                const key = field.key ?? `field_${index}`;
                const label = field.label ?? key;
                const helpText = field.helpText ?? null;
                const required = Boolean(field.required);
                const defaultStringValue =
                  typeof field.defaultValue === 'string' ? field.defaultValue : '';
                const defaultBooleanValue =
                  typeof field.defaultValue === 'boolean' ? field.defaultValue : false;

                if (field.type === 'long-text') {
                  return (
                    <label key={key} className="block space-y-1">
                      <span className="text-sm font-medium">
                        {label}
                        {required ? ' *' : ''}
                      </span>
                      <textarea
                        disabled
                        rows={4}
                        defaultValue={defaultStringValue}
                        className="w-full rounded border p-2 text-sm bg-gray-50"
                      />
                      {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                    </label>
                  );
                }

                if (field.type === 'select') {
                  return (
                    <label key={key} className="block space-y-1">
                      <span className="text-sm font-medium">
                        {label}
                        {required ? ' *' : ''}
                      </span>
                      <select
                        disabled
                        defaultValue={defaultStringValue}
                        className="w-full rounded border p-2 text-sm bg-gray-50"
                      >
                        <option value="">Select an option</option>
                        {(field.options ?? []).map((option, optionIndex) => (
                          <option key={`${key}-option-${optionIndex}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                    </label>
                  );
                }

                if (field.type === 'checkbox') {
                  return (
                    <label key={key} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        disabled
                        defaultChecked={defaultBooleanValue}
                        className="mt-1"
                      />
                      <span className="text-sm">
                        <span className="font-medium">
                          {label}
                          {required ? ' *' : ''}
                        </span>
                        {helpText && (
                          <span className="block text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>
                        )}
                      </span>
                    </label>
                  );
                }

                if (field.type === 'file-upload') {
                  return (
                    <label key={key} className="block space-y-1">
                      <span className="text-sm font-medium">
                        {label}
                        {required ? ' *' : ''}
                      </span>
                      <input
                        disabled
                        type="file"
                        className="w-full rounded border p-2 text-sm bg-gray-50"
                      />
                      {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                    </label>
                  );
                }

                return (
                  <label key={key} className="block space-y-1">
                    <span className="text-sm font-medium">
                      {label}
                      {required ? ' *' : ''}
                    </span>
                    <input
                      disabled
                      type={field.type === 'date' ? 'date' : 'text'}
                      defaultValue={defaultStringValue}
                      className="w-full rounded border p-2 text-sm bg-gray-50"
                    />
                    {helpText && <span className="text-xs text-[rgb(var(--color-text-600))]">{helpText}</span>}
                  </label>
                );
              })}
            </form>
          ) : (
            <ul className="space-y-1 text-sm">
              <li>No fields configured.</li>
            </ul>
          )}
        </div>
        <pre className="text-xs bg-[rgb(var(--color-background-100))] p-3 rounded overflow-auto">
          {JSON.stringify(data.form.schema, null, 2)}
        </pre>
      </Card>

      <Card id="service-request-editor-execution" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Execution</h2>
        <div className="grid gap-2">
          <label
            htmlFor="service-request-execution-provider-select"
            className="text-sm font-medium text-[rgb(var(--color-text-700))]"
          >
            Execution Provider
          </label>
          <div className="flex items-center gap-2">
            <select
              id="service-request-execution-provider-select"
              className="border rounded px-3 py-2 text-sm"
              value={data.execution.executionProvider}
              onChange={async (event) => {
                try {
                  await updateServiceRequestExecutionProviderAction(
                    data.definitionId,
                    event.target.value
                  );
                  await reloadDefinitionEditorState(data.definitionId);
                  toast.success('Execution provider updated');
                } catch (error) {
                  console.error('Failed to update execution provider', error);
                  toast.error('Failed to update execution provider');
                }
              }}
            >
              {data.execution.availableExecutionProviders.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.displayName} ({provider.executionMode})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <label
            htmlFor="service-request-form-behavior-provider-select"
            className="text-sm font-medium text-[rgb(var(--color-text-700))]"
          >
            Form Behavior Provider
          </label>
          <div className="flex items-center gap-2">
            <select
              id="service-request-form-behavior-provider-select"
              className="border rounded px-3 py-2 text-sm"
              value={formBehaviorProviderInput}
              onChange={async (event) => {
                try {
                  setFormBehaviorProviderInput(event.target.value);
                  await updateServiceRequestFormBehaviorProviderAction(
                    data.definitionId,
                    event.target.value
                  );
                  await reloadDefinitionEditorState(data.definitionId);
                  toast.success('Form behavior provider updated');
                } catch (error) {
                  console.error('Failed to update form behavior provider', error);
                  toast.error('Failed to update form behavior provider');
                }
              }}
            >
              {data.execution.availableFormBehaviorProviders.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <label
            htmlFor="service-request-visibility-provider-select"
            className="text-sm font-medium text-[rgb(var(--color-text-700))]"
          >
            Visibility Provider
          </label>
          <div className="flex items-center gap-2">
            <select
              id="service-request-visibility-provider-select"
              className="border rounded px-3 py-2 text-sm"
              value={visibilityProviderInput}
              onChange={async (event) => {
                try {
                  setVisibilityProviderInput(event.target.value);
                  await updateServiceRequestVisibilityProviderAction(
                    data.definitionId,
                    event.target.value
                  );
                  await reloadDefinitionEditorState(data.definitionId);
                  toast.success('Visibility provider updated');
                } catch (error) {
                  console.error('Failed to update visibility provider', error);
                  toast.error('Failed to update visibility provider');
                }
              }}
            >
              {data.execution.availableVisibilityProviders.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isTicketOnlyExecution && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-background-100))]">
            <h3 className="text-sm font-semibold">Ticket Routing Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="grid gap-1 text-sm md:col-span-2">
                <span className="font-medium">Board</span>
                <BoardPicker
                  id="service-request-ticket-board-id"
                  boards={ticketRoutingBoards}
                  onSelect={(boardId) => void handleTicketRoutingBoardChange(boardId)}
                  selectedBoardId={ticketRoutingConfigInput.boardId || null}
                  filterState={ticketRoutingBoardFilterState}
                  onFilterStateChange={setTicketRoutingBoardFilterState}
                  placeholder="Select Board"
                />
              </div>
              <div className="grid gap-1 text-sm">
                <span className="font-medium">Status</span>
                <CustomSelect
                  id="service-request-ticket-status-id"
                  value={ticketRoutingConfigInput.statusId}
                  onValueChange={(value) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      statusId: value,
                    }))
                  }
                  options={ticketStatusOptions}
                  placeholder="Select Status"
                  disabled={!ticketRoutingConfigInput.boardId || ticketRoutingLoading}
                />
              </div>
              <div className="grid gap-1 text-sm">
                <span className="font-medium">Assigned User</span>
                <UserPicker
                  id="service-request-ticket-assigned-user-id"
                  value={ticketRoutingConfigInput.assignedToUserId}
                  onValueChange={(value) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      assignedToUserId: value,
                    }))
                  }
                  users={ticketRoutingUsers}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  placeholder="Not assigned"
                  userTypeFilter="internal"
                  buttonWidth="full"
                />
              </div>
              {ticketRoutingConfigInput.boardId && (
                <div className="grid gap-1 text-sm md:col-span-2">
                  <span className="font-medium">Category</span>
                  <CategoryPicker
                    id="service-request-ticket-category-id"
                    categories={ticketRoutingCategories}
                    selectedCategories={ticketRoutingSelectedCategories}
                    onSelect={(categoryIds) => {
                      setTicketRoutingSelectedCategories(categoryIds);
                      const selectedCategory = ticketRoutingCategories.find(
                        (category) => category.category_id === categoryIds[0]
                      );
                      setTicketRoutingConfigInput((previous) => ({
                        ...previous,
                        categoryId: selectedCategory?.parent_category ?? selectedCategory?.category_id ?? '',
                        subcategoryId:
                          selectedCategory?.parent_category ? selectedCategory.category_id : '',
                      }));
                    }}
                    placeholder="Select category"
                    multiSelect={false}
                    allowEmpty={true}
                    showReset={true}
                  />
                </div>
              )}
              {ticketRoutingBoardConfig?.priority_type === 'custom' && (
                <div className="grid gap-1 text-sm">
                  <span className="font-medium">Priority</span>
                  <PrioritySelect
                    id="service-request-ticket-priority-id"
                    value={ticketRoutingConfigInput.priorityId || null}
                    onValueChange={(value) =>
                      setTicketRoutingConfigInput((previous) => ({
                        ...previous,
                        priorityId: value,
                      }))
                    }
                    options={ticketPriorityOptions}
                    placeholder="Select Priority"
                    disabled={!ticketRoutingConfigInput.boardId}
                  />
                </div>
              )}
              {ticketRoutingBoardConfig?.priority_type === 'itil' && (
                <>
                  <div className="grid gap-1 text-sm">
                    <span className="font-medium">Impact</span>
                    <CustomSelect
                      id="service-request-ticket-itil-impact"
                      value={ticketRoutingConfigInput.itilImpact}
                      onValueChange={(value) =>
                        setTicketRoutingConfigInput((previous) => ({
                          ...previous,
                          itilImpact: value,
                        }))
                      }
                      options={ITIL_IMPACT_OPTIONS}
                      placeholder="Select Impact"
                    />
                  </div>
                  <div className="grid gap-1 text-sm">
                    <span className="font-medium">Urgency</span>
                    <CustomSelect
                      id="service-request-ticket-itil-urgency"
                      value={ticketRoutingConfigInput.itilUrgency}
                      onValueChange={(value) =>
                        setTicketRoutingConfigInput((previous) => ({
                          ...previous,
                          itilUrgency: value,
                        }))
                      }
                      options={ITIL_URGENCY_OPTIONS}
                      placeholder="Select Urgency"
                    />
                  </div>
                  <div className="grid gap-1 text-sm md:col-span-2">
                    <span className="font-medium">Priority (Calculated)</span>
                    <div className="rounded border px-3 py-2 text-sm bg-[rgb(var(--color-background-50))]">
                      {calculatedItilPriority ? (
                        <span>
                          {ItilLabels.priority[calculatedItilPriority]} (Impact {ticketRoutingConfigInput.itilImpact} x Urgency {ticketRoutingConfigInput.itilUrgency})
                        </span>
                      ) : (
                        <span className="text-[rgb(var(--color-text-600))]">
                          Select impact and urgency
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Title Field Key</span>
                <input
                  id="service-request-ticket-title-field-key"
                  className="border rounded px-3 py-2 text-sm"
                  value={ticketRoutingConfigInput.titleFieldKey}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      titleFieldKey: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="font-medium">Description Prefix</span>
                <textarea
                  id="service-request-ticket-description-prefix"
                  className="border rounded px-3 py-2 text-sm min-h-[72px]"
                  value={ticketRoutingConfigInput.descriptionPrefix}
                  onChange={(event) =>
                    setTicketRoutingConfigInput((previous) => ({
                      ...previous,
                      descriptionPrefix: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div>
              <Button
                id="service-request-ticket-config-save"
                variant="outline"
                onClick={() => void saveTicketRoutingConfig()}
              >
                Save Ticket Routing
              </Button>
            </div>
          </div>
        )}
        {isWorkflowBackedExecution && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-background-100))]">
            <h3 className="text-sm font-semibold">Workflow Configuration</h3>
            <div className="grid gap-2">
              <label
                htmlFor="service-request-workflow-id-input"
                className="text-sm font-medium text-[rgb(var(--color-text-700))]"
              >
                Workflow ID
              </label>
              <input
                id="service-request-workflow-id-input"
                className="border rounded px-3 py-2 text-sm"
                placeholder="workflow-id"
                value={workflowIdInput}
                onChange={(event) => setWorkflowIdInput(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label
                htmlFor="service-request-workflow-input-mapping"
                className="text-sm font-medium text-[rgb(var(--color-text-700))]"
              >
                Workflow Input Mapping (JSON object)
              </label>
              <textarea
                id="service-request-workflow-input-mapping"
                className="border rounded px-3 py-2 text-sm font-mono min-h-[140px]"
                value={workflowInputMappingText}
                onChange={(event) => setWorkflowInputMappingText(event.target.value)}
              />
              <p className="text-xs text-[rgb(var(--color-text-600))]">
                Example: &#123;&quot;requestedBy&quot;:&quot;payload.request_title&quot;,&quot;ticketReference&quot;:&quot;ticketId&quot;&#125;
              </p>
            </div>
            <div>
              <Button
                id="service-request-workflow-config-save"
                variant="outline"
                onClick={async () => {
                  try {
                    const parsedInputMapping = workflowInputMappingText.trim()
                      ? JSON.parse(workflowInputMappingText)
                      : {};
                    if (
                      !parsedInputMapping ||
                      typeof parsedInputMapping !== 'object' ||
                      Array.isArray(parsedInputMapping)
                    ) {
                      toast.error('Workflow input mapping must be a JSON object');
                      return;
                    }

                    const nextExecutionConfig: Record<string, unknown> = {
                      ...data.execution.executionConfig,
                      workflowId: workflowIdInput.trim(),
                      inputMapping: parsedInputMapping as Record<string, string>,
                    };

                    await updateServiceRequestExecutionConfigAction(
                      data.definitionId,
                      nextExecutionConfig
                    );
                    await reloadDefinitionEditorState(data.definitionId);
                    toast.success('Workflow configuration updated');
                  } catch (error) {
                    console.error('Failed to update workflow configuration', error);
                    toast.error('Invalid workflow configuration JSON');
                  }
                }}
              >
                Save Workflow Settings
              </Button>
            </div>
          </div>
        )}
        {data.execution.showAdvancedFormBehaviorConfigPanel && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-background-100))]">
            <div className="text-sm font-semibold">Advanced Form Behavior</div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Form Behavior Config (JSON object)</span>
              <textarea
                id="service-request-form-behavior-config"
                className="border rounded px-3 py-2 text-sm font-mono min-h-[140px]"
                value={formBehaviorConfigText}
                onChange={(event) => setFormBehaviorConfigText(event.target.value)}
              />
            </label>
            <div>
              <Button
                id="service-request-form-behavior-config-save"
                variant="outline"
                onClick={async () => {
                  try {
                    const parsed = formBehaviorConfigText.trim()
                      ? JSON.parse(formBehaviorConfigText)
                      : {};
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                      toast.error('Form behavior config must be a JSON object');
                      return;
                    }
                    await updateServiceRequestFormBehaviorConfigAction(
                      data.definitionId,
                      parsed as Record<string, unknown>
                    );
                    await reloadDefinitionEditorState(data.definitionId);
                    toast.success('Form behavior config updated');
                  } catch (error) {
                    console.error('Failed to update form behavior config', error);
                    toast.error('Invalid form behavior JSON');
                  }
                }}
              >
                Save Form Behavior Config
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-background-100))]">
          <div className="text-sm font-semibold">Visibility Configuration</div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Visibility Config (JSON object)</span>
            <textarea
              id="service-request-visibility-config"
              className="border rounded px-3 py-2 text-sm font-mono min-h-[140px]"
              value={visibilityConfigText}
              onChange={(event) => setVisibilityConfigText(event.target.value)}
            />
          </label>
          <div>
            <Button
              id="service-request-visibility-config-save"
              variant="outline"
              onClick={async () => {
                try {
                  const parsed = visibilityConfigText.trim()
                    ? JSON.parse(visibilityConfigText)
                    : {};
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    toast.error('Visibility config must be a JSON object');
                    return;
                  }
                  await updateServiceRequestVisibilityConfigAction(
                    data.definitionId,
                    parsed as Record<string, unknown>
                  );
                  await reloadDefinitionEditorState(data.definitionId);
                  toast.success('Visibility config updated');
                } catch (error) {
                  console.error('Failed to update visibility config', error);
                  toast.error('Invalid visibility JSON');
                }
              }}
            >
              Save Visibility Config
            </Button>
          </div>
        </div>
        <FieldRow label="Execution Provider" value={data.execution.executionProvider} />
        <FieldRow label="Execution Config" value={JSON.stringify(data.execution.executionConfig)} />
        <FieldRow label="Form Behavior Provider" value={data.execution.formBehaviorProvider} />
        <FieldRow label="Visibility Provider" value={data.execution.visibilityProvider} />
      </Card>

      <Card id="service-request-editor-publish" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Publish</h2>
        <FieldRow label="Current Draft State" value={draftLifecycleLabel ?? '-'} />
        <FieldRow
          label="Last Published Version"
          value={data.publish.publishedVersionNumber ? `v${data.publish.publishedVersionNumber}` : 'Never published'}
        />
        <FieldRow
          label="Published At"
          value={data.publish.publishedAt ? new Date(data.publish.publishedAt).toLocaleString() : '-'}
        />
        <FieldRow label="Draft Updated At" value={new Date(data.publish.draftUpdatedAt).toLocaleString()} />
        {validationErrors.length > 0 ? (
          <div className="rounded border border-[rgb(var(--color-danger-400))] bg-[rgb(var(--color-danger-100))] p-3 text-sm">
            <div className="font-semibold mb-1">Publish Validation</div>
            <ul className="list-disc pl-5">
              {validationErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded border border-[rgb(var(--color-success-300))] bg-[rgb(var(--color-success-100))] p-3 text-sm">
            Publish validation passed.
          </div>
        )}
      </Card>

      <Card id="service-request-editor-submissions" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Submissions</h2>
        {submissions.length === 0 ? (
          <div className="text-sm text-[rgb(var(--color-text-600))]">No submissions yet for this definition.</div>
        ) : (
          <div className="space-y-2">
            {submissions.map((submission) => (
              <div
                key={submission.submission_id}
                className="border rounded p-3 flex items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <div className="font-medium">{submission.request_name}</div>
                  <div className="text-[rgb(var(--color-text-600))]">
                    {new Date(submission.submitted_at).toLocaleString()} · {submission.execution_status}
                  </div>
                </div>
                <Button
                  id={`service-request-submission-detail-${submission.submission_id}`}
                  variant="outline"
                  onClick={async () => {
                    const detail = await getServiceRequestDefinitionSubmissionDetailAction(
                      definitionId,
                      submission.submission_id
                    );
                    setSelectedSubmissionId(submission.submission_id);
                    setSelectedSubmissionDetail(detail as DefinitionSubmissionDetail | null);
                  }}
                >
                  View Detail
                </Button>
              </div>
            ))}
          </div>
        )}
        {selectedSubmissionDetail && (
          <div className="rounded border p-3 bg-[rgb(var(--color-background-100))] space-y-2">
            <div className="text-sm font-semibold">Submission Detail</div>
            <FieldRow label="Submission ID" value={selectedSubmissionDetail.submission_id} />
            <FieldRow label="Requester User" value={selectedSubmissionDetail.requester_user_id ?? '-'} />
            <FieldRow label="Client" value={selectedSubmissionDetail.client_id} />
            <FieldRow label="Contact" value={selectedSubmissionDetail.contact_id ?? '-'} />
            <FieldRow label="Ticket Reference" value={selectedSubmissionDetail.created_ticket_id ?? '-'} />
            <FieldRow label="Workflow Reference" value={selectedSubmissionDetail.workflow_execution_id ?? '-'} />
            <FieldRow
              label="Execution Error"
              value={selectedSubmissionDetail.execution_error_summary ?? '-'}
            />
            <pre className="text-xs bg-white p-2 rounded overflow-auto">
              {JSON.stringify(selectedSubmissionDetail.submitted_payload, null, 2)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}
