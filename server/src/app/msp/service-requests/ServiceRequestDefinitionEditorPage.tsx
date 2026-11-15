'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useDrawer } from '@alga-psa/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Eye, PencilRuler } from 'lucide-react';
import { getFieldElementKind } from '@alga-psa/ui/form-fields';
import {
  getServiceRequestDefinitionSubmissionDetailAction,
  getServiceRequestDefinitionEditorDataAction,
  getServiceRequestTicketRoutingBoardDataAction,
  getServiceRequestTicketRoutingReferenceDataAction,
  listServiceRequestDefinitionSubmissionsAction,
  publishServiceRequestDefinitionAction,
  saveServiceRequestDefinitionDraftAction,
  searchLinkedServicesForDefinitionAction,
  updateServiceRequestBasicsAction,
  updateServiceRequestFormBehaviorConfigAction,
  updateServiceRequestFormBehaviorProviderAction,
  updateServiceRequestExecutionConfigAction,
  setLinkedServiceForDefinitionAction,
  updateServiceRequestExecutionProviderAction,
  updateServiceRequestAudienceAction,
  updateServiceRequestVisibilityProviderAction,
  validateServiceRequestDefinitionForPublishAction,
} from './actions';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Card } from '@alga-psa/ui/components/Card';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import MspTicketDetailsContainerClient from '@alga-psa/msp-composition/tickets/MspTicketDetailsContainerClient';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TFunction } from 'i18next';
import { ServiceRequestCard } from '../../client-portal/request-services/ServiceRequestCard';
import { ServiceRequestFormRenderer } from '../../../components/service-requests/ServiceRequestFormRenderer';
import { ServiceRequestIconPicker } from './ServiceRequestIconPicker';
import { AnswerMappingSection } from './AnswerMappingSection';
import {
  ServiceRequestAudienceEditor,
  type ServiceRequestAudienceValue,
  type ServiceRequestAudienceInitialValue,
} from './ServiceRequestAudienceEditor';
import { SubmissionMappingPanel } from './SubmissionMappingPanel';
import { SERVICE_REQUEST_ICON_OPTIONS } from '../../../lib/service-requests/iconCatalog';
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { PrioritySelect } from '@alga-psa/ui/components/tickets/PrioritySelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { CategoryPicker } from '@alga-psa/tickets/components';
import { getConsolidatedTicketData } from '@alga-psa/tickets/actions/optimizedTicketActions';
import { calculateItilPriority, ItilLabels } from '@alga-psa/tickets/lib/itilUtils';
import type { IBoard, IPriority, ITicketCategory, ITicketStatus, IUser } from '@alga-psa/types';
import { getSurveyTicketSummary } from '@alga-psa/surveys/actions/survey-actions/surveyDashboardActions';
import { TemplateTokenInput } from '@alga-psa/ui/components/TemplateTokenInput';
import {
  buildTicketRoutingExecutionConfig,
  getServiceRequestDraftLifecycleLabel,
  resolveTicketSubjectTemplate,
} from '../../../lib/service-requests/editorHelpers';
import {
  normalizeBasicFormSchema,
  type BasicFormField,
} from '../../../lib/service-requests/formSchema';
import {
  findUnknownServiceRequestTemplateTokens,
  getServiceRequestTemplateFields,
} from '../../../lib/service-requests/ticketTextTemplate';

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
    audience: ServiceRequestAudienceInitialValue;
    removedAudienceReferences: string[];
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

interface DefinitionSubmissionAuditEvent {
  audit_id: string;
  operation: string;
  user_id: string | null;
  actor_name: string | null;
  timestamp: string | Date;
  details: Record<string, unknown>;
}

interface DefinitionSubmissionDetail extends DefinitionSubmissionRow {
  definition_id: string;
  definition_version_id: string;
  definition_version_number: number;
  submitted_payload: Record<string, unknown>;
  execution_error_summary: string | null;
  requester_user_name: string | null;
  client_name: string | null;
  contact_name: string | null;
  created_ticket_display: string | null;
  audit_events: DefinitionSubmissionAuditEvent[];
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3 text-sm">
      <div className="font-medium text-[rgb(var(--color-text-700))]">{label}</div>
      <div className="text-[rgb(var(--color-text-900))] break-words">{value}</div>
    </div>
  );
}

/** The schema the summary and the preview read; the builder owns editing it. */
type FormField = BasicFormField;

interface TicketRoutingBoardConfig {
  category_type: 'custom' | 'itil';
  priority_type: 'custom' | 'itil';
  display_itil_impact?: boolean;
  display_itil_urgency?: boolean;
}

const isReturnedActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

function getSchemaFields(schema: Record<string, unknown>): FormField[] {
  const fields = schema.fields;
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields.filter(
    (field): field is FormField => Boolean(field && typeof field === 'object')
  );
}

function getSelectedIconLabel(iconValue: string, t: TFunction): string {
  const match = SERVICE_REQUEST_ICON_OPTIONS.find((option) => option.value === iconValue);
  if (match) {
    return t(`icons.${match.value}`, { defaultValue: match.label });
  }
  return t('editor.basics.noIconSelected');
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

const VALIDATION_ERROR_KEY_MAP: Record<string, string> = {
  'Name is required': 'nameRequired',
  'Linked service no longer exists': 'linkedServiceMissing',
  'Execution: Ticket routing board is required': 'executionBoardRequired',
  'Execution: Ticket routing status is required': 'executionStatusRequired',
  'Execution: Ticket routing priority is required': 'executionPriorityRequired',
  'Execution: Ticket routing requires both ITIL impact and urgency when priority is not set':
    'executionItilImpactUrgencyMismatch',
};

function translateValidationError(error: string, t: TFunction): string {
  const known = VALIDATION_ERROR_KEY_MAP[error];
  if (known) {
    return t(`editor.publishSection.errors.${known}`, { defaultValue: error });
  }

  const unknownProviderMatch = error.match(/^Unknown (execution|form behavior|visibility) provider: (.+)$/);
  if (unknownProviderMatch) {
    const [, kind, key] = unknownProviderMatch;
    const mapped =
      kind === 'execution'
        ? 'unknownExecutionProvider'
        : kind === 'form behavior'
          ? 'unknownFormBehaviorProvider'
          : 'unknownVisibilityProvider';
    return t(`editor.publishSection.errors.${mapped}`, { key, defaultValue: error });
  }

  return error;
}

function buildItilImpactOptions(t: TFunction): SelectOption[] {
  return ['1', '2', '3', '4', '5'].map((value) => ({
    value,
    label: t(`editor.execution.itilImpact.${value}`),
  }));
}

function buildItilUrgencyOptions(t: TFunction): SelectOption[] {
  return ['1', '2', '3', '4', '5'].map((value) => ({
    value,
    label: t(`editor.execution.itilUrgency.${value}`),
  }));
}

export default function ServiceRequestDefinitionEditorPage() {
  const { t } = useTranslation('msp/service-requests');
  const { formatDate } = useFormatters();
  const params = useParams();
  const definitionId = String(params?.definitionId ?? '');
  const itilImpactOptions = useMemo(() => buildItilImpactOptions(t), [t]);
  const itilUrgencyOptions = useMemo(() => buildItilUrgencyOptions(t), [t]);
  const [data, setData] = useState<EditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
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
  // Unsaved edits to the Advanced (JSON) panel; null shows the saved config. Saved only by
  // the panel's own button (never by "Save all"), so it cannot overwrite "Show when…" edits.
  const [formBehaviorConfigDraft, setFormBehaviorConfigDraft] = useState<string | null>(null);
  const savedFormBehaviorConfigText = JSON.stringify(
    data?.execution.formBehaviorConfig ?? {},
    null,
    2
  );
  // A draft is based on the saved config it was typed over; once that changes (a
  // "Show when…" save, or another reload), drop the draft rather than save stale rules.
  useEffect(() => {
    setFormBehaviorConfigDraft(null);
  }, [savedFormBehaviorConfigText]);
  const [visibilityProviderInput, setVisibilityProviderInput] = useState(
    'all-authenticated-client-users'
  );
  const [audienceDraft, setAudienceDraft] = useState<ServiceRequestAudienceValue>({ join: 'and', clauses: [] });
  const [ticketRoutingConfigInput, setTicketRoutingConfigInput] = useState({
    boardId: '',
    statusId: '',
    priorityId: '',
    categoryId: '',
    subcategoryId: '',
    assignedToUserId: '',
    itilImpact: '',
    itilUrgency: '',
    titleTemplate: '',
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
  const { openDrawer, replaceDrawer } = useDrawer();

  const isWorkflowBackedExecution = data?.execution.showWorkflowExecutionConfigPanel === true;
  const isTicketOnlyExecution = data?.execution.executionProvider === 'ticket-only';
  const isStoreOnlyExecution = data?.execution.executionProvider === 'store-only';
  const hasLivePublishedVersion = Boolean(data?.publish.publishedVersionNumber);
  const draftLifecycleLabel = getServiceRequestDraftLifecycleLabel(
    data?.lifecycleState,
    hasLivePublishedVersion
  );
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
  const basicsCategoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('editor.basics.uncategorized') },
      ...data?.basics.availableCategories.map((category) => ({
        value: category.categoryId,
        label: category.categoryName,
      })) ?? [],
    ],
    [data?.basics.availableCategories, t]
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

  const openTicketDrawer = async (ticketId: string | null) => {
    if (!ticketId) {
      return;
    }

    openDrawer(
      <div className="p-4 text-sm text-[rgb(var(--color-text-600))]">{t('editor.submissions.loadingTicket')}</div>,
      undefined,
      undefined,
      '900px'
    );

    try {
      const [ticketData, surveySummary] = await Promise.all([
        getConsolidatedTicketData(ticketId),
        getSurveyTicketSummary(ticketId).catch((error) => {
          console.error('[ServiceRequestDefinitionEditorPage] Failed to load survey summary', error);
          return null;
        }),
      ]);

      replaceDrawer(
        <div className="bg-[rgb(var(--color-app-ground))]">
          <MspTicketDetailsContainerClient
            ticketData={ticketData as any}
            surveySummary={surveySummary ?? null}
          />
        </div>,
        undefined,
        '900px'
      );
    } catch (error) {
      console.error('[ServiceRequestDefinitionEditorPage] Failed to load ticket drawer', error);
      replaceDrawer(
        <div className="p-4 text-sm text-[rgb(var(--color-destructive))]">
          {error instanceof Error ? error.message : t('editor.submissions.ticketLoadError')}
        </div>,
        undefined,
        '900px'
      );
    }
  };

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
      if (isReturnedActionError(boardData)) {
        toast.error(getErrorMessage(boardData));
        setTicketRoutingStatuses([]);
        setTicketRoutingCategories([]);
        setTicketRoutingBoardConfig(null);
        return;
      }
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
      // A legacy titleFieldKey loads as `{{key}}`; saving writes it as the template.
      titleTemplate: resolveTicketSubjectTemplate(config),
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
    setVisibilityProviderInput(data.execution.visibilityProvider);
    setAudienceDraft(data.execution.audience);
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
      if (isReturnedActionError(boardData)) {
        toast.error(getErrorMessage(boardData));
        setTicketRoutingStatuses([]);
        setTicketRoutingCategories([]);
        setTicketRoutingBoardConfig(null);
        return;
      }
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

  const templateFields = getServiceRequestTemplateFields(data?.form.schema);
  const templateTokenOptions = templateFields.map((field) => ({
    token: field.key,
    label: field.label,
    secondary: field.key,
  }));
  const unknownSubjectTokens = findUnknownServiceRequestTemplateTokens(
    ticketRoutingConfigInput.titleTemplate,
    data?.form.schema
  );
  const unknownDescriptionTokens = findUnknownServiceRequestTemplateTokens(
    ticketRoutingConfigInput.descriptionPrefix,
    data?.form.schema
  );
  const hasUnknownTemplateTokens = unknownSubjectTokens.length > 0 || unknownDescriptionTokens.length > 0;
  const formatUnknownTokens = (tokens: string[]) =>
    tokens.length > 0
      ? t('editor.execution.ticketRouting.unknownFields', { fields: tokens.map((token) => `{{${token}}}`).join(', ') })
      : undefined;

  const saveTicketRoutingConfig = async () => {
    if (!data) {
      return;
    }

    if (hasUnknownTemplateTokens) {
      toast.error(t('editor.execution.ticketRouting.unknownFieldsBlocked'));
      return;
    }

    const selectedCategoryId = ticketRoutingSelectedCategories[0] ?? '';
    const selectedCategory = ticketRoutingCategories.find(
      (category) => category.category_id === selectedCategoryId
    );

    const nextExecutionConfig = buildTicketRoutingExecutionConfig({
      existingExecutionConfig: data.execution.executionConfig,
      ticketRoutingConfigInput,
      selectedCategory,
      boardPriorityType: ticketRoutingBoardConfig?.priority_type ?? null,
    });

    await updateServiceRequestExecutionConfigAction(data.definitionId, nextExecutionConfig);
    await reloadDefinitionEditorState(data.definitionId);
    toast.success(t('messages.success.ticketRoutingUpdated'));
  };

  const handleSaveAll = async () => {
    if (!data) {
      return;
    }

    const failures: string[] = [];

    try {
      await updateServiceRequestBasicsAction(data.definitionId, {
        name: basicsInput.name,
        description:
          basicsInput.description.trim().length > 0 ? basicsInput.description : null,
        icon: basicsInput.icon.trim().length > 0 ? basicsInput.icon : null,
        categoryId:
          basicsInput.categoryId.trim().length > 0 ? basicsInput.categoryId : null,
        sortOrder: Number.parseInt(basicsInput.sortOrder, 10) || 0,
      });
    } catch (error) {
      console.error('Save all: basics failed', error);
      failures.push(t('editor.basics.title'));
    }

    if (isTicketOnlyExecution) {
      try {
        if (hasUnknownTemplateTokens) {
          throw new Error(t('editor.execution.ticketRouting.unknownFieldsBlocked'));
        }
        const selectedCategoryId = ticketRoutingSelectedCategories[0] ?? '';
        const selectedCategory = ticketRoutingCategories.find(
          (category) => category.category_id === selectedCategoryId
        );
        const nextExecutionConfig = buildTicketRoutingExecutionConfig({
          existingExecutionConfig: data.execution.executionConfig,
          ticketRoutingConfigInput,
          selectedCategory,
          boardPriorityType: ticketRoutingBoardConfig?.priority_type ?? null,
        });
        await updateServiceRequestExecutionConfigAction(data.definitionId, nextExecutionConfig);
      } catch (error) {
        console.error('Save all: ticket routing failed', error);
        failures.push(t('editor.execution.ticketRouting.title'));
      }
    }

    if (isWorkflowBackedExecution) {
      try {
        const parsedInputMapping = workflowInputMappingText.trim()
          ? JSON.parse(workflowInputMappingText)
          : {};
        if (
          !parsedInputMapping ||
          typeof parsedInputMapping !== 'object' ||
          Array.isArray(parsedInputMapping)
        ) {
          throw new Error('Workflow input mapping must be an object');
        }
        await updateServiceRequestExecutionConfigAction(data.definitionId, {
          ...data.execution.executionConfig,
          workflowId: workflowIdInput.trim(),
          inputMapping: parsedInputMapping as Record<string, string>,
        });
      } catch (error) {
        console.error('Save all: workflow config failed', error);
        failures.push(t('editor.execution.workflow.title'));
      }
    }

    try {
      const result = await updateServiceRequestAudienceAction(data.definitionId, audienceDraft);
      if (result && 'success' in result && result.success === false) {
        throw new Error(result.message);
      }
    } catch (error) {
      console.error('Save all: audience failed', error);
      failures.push(t('editor.execution.visibility.audience.title'));
    }

    await reloadDefinitionEditorState(data.definitionId);

    if (failures.length > 0) {
      toast.error(
        t('messages.error.saveAllPartial', {
          sections: failures.join(', '),
          defaultValue: `Some sections couldn't be saved: ${failures.join(', ')}`,
        })
      );
    } else {
      toast.success(t('messages.success.draftSaved'));
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-[rgb(var(--color-text-600))]">{t('editor.loading')}</div>;
  }

  if (!data) {
    return <div className="p-6 text-sm text-[rgb(var(--color-destructive))]">{t('editor.notFound')}</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="mb-3">
          <BackNav href="/msp/service-requests">{t('editor.backNav')}</BackNav>
        </div>
        <h1 className="text-2xl font-semibold">{data.basics.name}</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('editor.currentState', { state: draftLifecycleLabel })}
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            id="service-request-editor-save-draft"
            variant="outline"
            onClick={async () => {
              if (data.lifecycleState === 'published') {
                try {
                  await saveServiceRequestDefinitionDraftAction(data.definitionId);
                  toast.success(t('messages.success.draftSaved'));
                } catch (error) {
                  console.error('Failed to create draft', error);
                  toast.error(t('messages.error.saveDraftFailed'));
                }
                return;
              }
              try {
                await handleSaveAll();
              } catch (error) {
                console.error('Failed to save draft', error);
                toast.error(t('messages.error.saveDraftFailed'));
              }
            }}
          >
            {data.lifecycleState === 'published' ? t('editor.createDraft') : t('editor.saveDraft')}
          </Button>
          <Button
            id="service-request-editor-publish"
            disabled={isPublishing}
            onClick={async () => {
              console.log('[publish] clicked', { definitionId: data.definitionId });
              setIsPublishing(true);
              try {
                const preCheck = await validateServiceRequestDefinitionForPublishAction(data.definitionId);
                const preCheckErrors = preCheck.errors ?? [];
                console.log('[publish] pre-check result', preCheck);
                setValidationErrors(preCheckErrors);
                if (preCheckErrors.length > 0) {
                  toast.error(
                    t('messages.error.publishBlockedByValidation', { count: preCheckErrors.length })
                  );
                  return;
                }

                const published = await publishServiceRequestDefinitionAction(data.definitionId);
                console.log('[publish] server action returned', published);
                toast.success(t('messages.success.definitionPublished'), { duration: 4000 });
                await reloadDefinitionEditorState(data.definitionId, true);
              } catch (error) {
                console.error('[publish] failed', error);
                const rawMessage = error instanceof Error ? error.message : '';
                const friendlyMessage = rawMessage.startsWith('Publish validation failed:')
                  ? t('messages.error.publishBlockedByValidation', { count: validationErrors.length || 1 })
                  : rawMessage || t('messages.error.publishFailed');
                toast.error(friendlyMessage, { duration: 5000 });
              } finally {
                setIsPublishing(false);
              }
            }}
          >
            {isPublishing ? t('editor.publishing') : t('editor.publish')}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">

      <Card id="service-request-editor-basics" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">{t('editor.basics.title')}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            id="service-request-basics-name"
            label={t('editor.basics.name')}
            containerClassName="mb-0"
            value={basicsInput.name}
            onChange={(event) =>
              setBasicsInput((previous) => ({
                ...previous,
                name: event.target.value,
              }))
            }
          />
          <div className="grid gap-1 text-sm md:col-span-2">
            <span className="font-medium">{t('editor.basics.icon')}</span>
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
              {t('editor.basics.iconSelected', { label: getSelectedIconLabel(basicsInput.icon, t) })}
            </span>
          </div>
          <div className="md:col-span-2">
            <TextArea
              id="service-request-basics-description"
              label={t('editor.basics.description')}
              wrapperClassName="mb-0"
              className="min-h-[96px]"
              value={basicsInput.description}
              onChange={(event) =>
                setBasicsInput((previous) => ({
                  ...previous,
                  description: event.target.value,
                }))
              }
            />
          </div>
          <CustomSelect
            id="service-request-basics-category"
            label={t('editor.basics.category')}
            value={basicsInput.categoryId}
            options={basicsCategoryOptions}
            onValueChange={(value) =>
              setBasicsInput((previous) => ({
                ...previous,
                categoryId: value,
              }))
            }
          />
          <Input
            id="service-request-basics-sort-order"
            label={t('editor.basics.sortOrder')}
            containerClassName="mb-0"
            type="number"
            value={basicsInput.sortOrder}
            onChange={(event) =>
              setBasicsInput((previous) => ({
                ...previous,
                sortOrder: event.target.value,
              }))
            }
          />
        </div>
        <div>
          <Button
            id="service-request-basics-save"
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
                toast.success(t('messages.success.basicsUpdated'));
              } catch (error) {
                console.error('Failed to update basics', error);
                toast.error(t('messages.error.basicsUpdateFailed'));
              }
            }}
          >
            {t('editor.basics.save')}
          </Button>
        </div>
      </Card>

      <Card id="service-request-editor-linkage" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">{t('editor.linkage.title')}</h2>
        <FieldRow label={t('editor.linkage.linkedService')} value={data.linkage.linkedServiceName ?? data.linkage.linkedServiceId ?? '-'} />
        <div className="flex gap-2">
          <input
            id="service-request-linked-service-search"
            className="border rounded px-3 py-2 text-sm flex-1"
            placeholder={t('editor.linkage.searchPlaceholder')}
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
            {t('editor.linkage.search')}
          </Button>
          <Button
            id="service-request-linked-service-clear"
            variant="outline"
            onClick={async () => {
              await setLinkedServiceForDefinitionAction(data.definitionId, null);
              await reloadDefinitionEditorState(data.definitionId);
              toast.success(t('messages.success.linkedServiceCleared'));
            }}
          >
            {t('editor.linkage.clear')}
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
                    {result.description ?? t('editor.linkage.noDescription')}
                  </div>
                </div>
                <Button
                  id={`service-request-linked-service-select-${result.service_id}`}
                  variant="outline"
                  onClick={async () => {
                    await setLinkedServiceForDefinitionAction(data.definitionId, result.service_id);
                    await reloadDefinitionEditorState(data.definitionId);
                    toast.success(t('messages.success.linkedService', { name: result.service_name }));
                  }}
                >
                  {t('editor.linkage.select')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="service-request-editor-form" className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{t('editor.form.title')}</h2>
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('editor.form.summary', {
                questions: getSchemaFields(data.form.schema).filter(
                  (field) => getFieldElementKind(field.type) === 'input'
                ).length,
                required: getSchemaFields(data.form.schema).filter(
                  (field) => getFieldElementKind(field.type) === 'input' && field.required
                ).length,
              })}
            </p>
          </div>
          <Link
            id="service-request-editor-open-form-builder"
            href={`/msp/service-requests/${data.definitionId}/form-builder`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[rgb(var(--color-primary-500))] px-3 py-2 text-sm font-medium text-white hover:bg-[rgb(var(--color-primary-600))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))]"
          >
            <PencilRuler className="h-4 w-4" />
            {t('editor.form.openBuilder')}
          </Link>
        </div>
        {getSchemaFields(data.form.schema).length === 0 ? (
          <p className="rounded border border-dashed border-[rgb(var(--color-border-200))] p-4 text-sm text-[rgb(var(--color-text-600))]">
            {t('editor.form.noFields')}
          </p>
        ) : (
          <ul id="service-request-editor-form-summary" className="space-y-1">
            {getSchemaFields(data.form.schema).map((field, index) => (
              <li
                key={`${field.key ?? index}-${index}`}
                className="flex items-center gap-2 rounded border border-[rgb(var(--color-border-200))] px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {field.type === 'divider' ? t('editor.form.types.divider') : field.label || field.key}
                </span>
                <span className="shrink-0 text-xs text-[rgb(var(--color-text-600))]">
                  {t(`editor.form.types.${field.type}`, { defaultValue: field.type })}
                </span>
                {field.required ? (
                  <span className="shrink-0 text-xs text-[rgb(var(--color-text-500))]">
                    {t('editor.form.requiredChip')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="service-request-editor-execution" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">{t('editor.execution.title')}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <CustomSelect
            id="service-request-execution-provider-select"
            label={t('editor.execution.executionProvider')}
            value={data.execution.executionProvider}
            options={data.execution.availableExecutionProviders.map((provider) => ({
              value: provider.key,
              label: t('editor.execution.providerDisplay', {
                displayName: provider.displayName,
                executionMode: provider.executionMode,
              }),
            }))}
            onValueChange={async (value) => {
              try {
                await updateServiceRequestExecutionProviderAction(data.definitionId, value);
                await reloadDefinitionEditorState(data.definitionId);
                toast.success(t('messages.success.executionProviderUpdated'));
              } catch (error) {
                console.error('Failed to update execution provider', error);
                toast.error(t('messages.error.executionProviderUpdateFailed'));
              }
            }}
          />
          <CustomSelect
            id="service-request-form-behavior-provider-select"
            label={t('editor.execution.formBehaviorProvider')}
            value={formBehaviorProviderInput}
            options={data.execution.availableFormBehaviorProviders.map((provider) => ({
              value: provider.key,
              label: provider.displayName,
            }))}
            onValueChange={async (value) => {
              try {
                setFormBehaviorProviderInput(value);
                await updateServiceRequestFormBehaviorProviderAction(data.definitionId, value);
                await reloadDefinitionEditorState(data.definitionId);
                toast.success(t('messages.success.formBehaviorProviderUpdated'));
              } catch (error) {
                console.error('Failed to update form behavior provider', error);
                toast.error(t('messages.error.formBehaviorProviderUpdateFailed'));
              }
            }}
          />
          <CustomSelect
            id="service-request-visibility-provider-select"
            label={t('editor.execution.visibilityProvider')}
            value={visibilityProviderInput}
            options={data.execution.availableVisibilityProviders.map((provider) => ({
              value: provider.key,
              label: provider.displayName,
            }))}
            onValueChange={async (value) => {
              try {
                setVisibilityProviderInput(value);
                await updateServiceRequestVisibilityProviderAction(data.definitionId, value);
                await reloadDefinitionEditorState(data.definitionId);
                toast.success(t('messages.success.visibilityProviderUpdated'));
              } catch (error) {
                console.error('Failed to update visibility provider', error);
                toast.error(t('messages.error.visibilityProviderUpdateFailed'));
              }
            }}
          />
        </div>
        {isStoreOnlyExecution && (
          <div
            id="service-request-store-only-explanation"
            className="space-y-1 rounded border p-3 bg-[rgb(var(--color-border-100))]"
          >
            <h3 className="text-sm font-semibold">{t('editor.execution.storeOnly.title')}</h3>
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('editor.execution.storeOnly.description')}
            </p>
          </div>
        )}
        {isTicketOnlyExecution && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-border-100))]">
            <h3 className="text-sm font-semibold">{t('editor.execution.ticketRouting.title')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="grid gap-1 text-sm md:col-span-2">
                <span className="font-medium">{t('editor.execution.ticketRouting.board')}</span>
                <BoardPicker
                  id="service-request-ticket-board-id"
                  boards={ticketRoutingBoards}
                  onSelect={(boardId) => void handleTicketRoutingBoardChange(boardId)}
                  selectedBoardId={ticketRoutingConfigInput.boardId || null}
                  filterState={ticketRoutingBoardFilterState}
                  onFilterStateChange={setTicketRoutingBoardFilterState}
                  placeholder={t('editor.execution.ticketRouting.boardPlaceholder')}
                />
              </div>
              <div className="grid gap-1 text-sm">
                <span className="font-medium">{t('editor.execution.ticketRouting.status')}</span>
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
                  placeholder={t('editor.execution.ticketRouting.statusPlaceholder')}
                  disabled={!ticketRoutingConfigInput.boardId || ticketRoutingLoading}
                />
              </div>
              <div className="grid gap-1 text-sm">
                <span className="font-medium">{t('editor.execution.ticketRouting.assignedUser')}</span>
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
                  placeholder={t('editor.execution.ticketRouting.assignedUserPlaceholder')}
                  userTypeFilter="internal"
                  buttonWidth="full"
                />
              </div>
              {ticketRoutingConfigInput.boardId && (
                <div className="grid gap-1 text-sm md:col-span-2">
                  <span className="font-medium">{t('editor.execution.ticketRouting.category')}</span>
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
                    placeholder={t('editor.execution.ticketRouting.categoryPlaceholder')}
                    multiSelect={false}
                    allowEmpty={true}
                    showReset={true}
                  />
                </div>
              )}
              {ticketRoutingBoardConfig?.priority_type === 'custom' && (
                <div className="grid gap-1 text-sm">
                  <span className="font-medium">{t('editor.execution.ticketRouting.priority')}</span>
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
                    placeholder={t('editor.execution.ticketRouting.priorityPlaceholder')}
                    disabled={!ticketRoutingConfigInput.boardId}
                  />
                </div>
              )}
              {ticketRoutingBoardConfig?.priority_type === 'itil' && (
                <>
                  <div className="grid gap-1 text-sm">
                    <span className="font-medium">{t('editor.execution.ticketRouting.impact')}</span>
                    <CustomSelect
                      id="service-request-ticket-itil-impact"
                      value={ticketRoutingConfigInput.itilImpact}
                      onValueChange={(value) =>
                        setTicketRoutingConfigInput((previous) => ({
                          ...previous,
                          itilImpact: value,
                        }))
                      }
                      options={itilImpactOptions}
                      placeholder={t('editor.execution.ticketRouting.impactPlaceholder')}
                    />
                  </div>
                  <div className="grid gap-1 text-sm">
                    <span className="font-medium">{t('editor.execution.ticketRouting.urgency')}</span>
                    <CustomSelect
                      id="service-request-ticket-itil-urgency"
                      value={ticketRoutingConfigInput.itilUrgency}
                      onValueChange={(value) =>
                        setTicketRoutingConfigInput((previous) => ({
                          ...previous,
                          itilUrgency: value,
                        }))
                      }
                      options={itilUrgencyOptions}
                      placeholder={t('editor.execution.ticketRouting.urgencyPlaceholder')}
                    />
                  </div>
                  <div className="grid gap-1 text-sm md:col-span-2">
                    <span className="font-medium">{t('editor.execution.ticketRouting.priorityCalculated')}</span>
                    <div className="rounded border px-3 py-2 text-sm bg-[rgb(var(--color-border-50))]">
                      {calculatedItilPriority ? (
                        <span>
                          {t('editor.execution.ticketRouting.priorityFormula', {
                            label: ItilLabels.priority[calculatedItilPriority],
                            impact: ticketRoutingConfigInput.itilImpact,
                            urgency: ticketRoutingConfigInput.itilUrgency,
                          })}
                        </span>
                      ) : (
                        <span className="text-[rgb(var(--color-text-600))]">
                          {t('editor.execution.ticketRouting.selectImpactAndUrgency')}
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}
              <div className="md:col-span-2">
                <TemplateTokenInput
                  id="service-request-ticket-subject-template"
                  label={t('editor.execution.ticketRouting.ticketSubject')}
                  value={ticketRoutingConfigInput.titleTemplate}
                  onChange={(titleTemplate) =>
                    setTicketRoutingConfigInput((previous) => ({ ...previous, titleTemplate }))
                  }
                  tokens={templateTokenOptions}
                  insertLabel={t('editor.execution.ticketRouting.insertField')}
                  noTokensHint={t('editor.execution.ticketRouting.noInsertableFields')}
                  helperText={t('editor.execution.ticketRouting.ticketSubjectHelp')}
                  error={formatUnknownTokens(unknownSubjectTokens)}
                />
              </div>
              <div className="md:col-span-2">
                <TemplateTokenInput
                  id="service-request-ticket-description-prefix"
                  multiline
                  label={t('editor.execution.ticketRouting.descriptionPrefix')}
                  value={ticketRoutingConfigInput.descriptionPrefix}
                  onChange={(descriptionPrefix) =>
                    setTicketRoutingConfigInput((previous) => ({ ...previous, descriptionPrefix }))
                  }
                  tokens={templateTokenOptions}
                  insertLabel={t('editor.execution.ticketRouting.insertField')}
                  noTokensHint={t('editor.execution.ticketRouting.noInsertableFields')}
                  error={formatUnknownTokens(unknownDescriptionTokens)}
                />
              </div>
            </div>
            <div>
              <Button
                id="service-request-ticket-config-save"
                onClick={() => void saveTicketRoutingConfig()}
              >
                {t('editor.execution.ticketRouting.save')}
              </Button>
            </div>
          </div>
        )}
        {isWorkflowBackedExecution && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-border-100))]">
            <h3 className="text-sm font-semibold">{t('editor.execution.workflow.title')}</h3>
            <Input
              id="service-request-workflow-id-input"
              label={t('editor.execution.workflow.workflowId')}
              containerClassName="mb-0"
              placeholder={t('editor.execution.workflow.workflowIdPlaceholder')}
              value={workflowIdInput}
              onChange={(event) => setWorkflowIdInput(event.target.value)}
            />
            <div>
              <TextArea
                id="service-request-workflow-input-mapping"
                label={t('editor.execution.workflow.inputMapping')}
                wrapperClassName="mb-0"
                className="min-h-[140px] font-mono"
                value={workflowInputMappingText}
                onChange={(event) => setWorkflowInputMappingText(event.target.value)}
              />
              <p className="mt-1 text-xs text-[rgb(var(--color-text-600))]">
                {t('editor.execution.workflow.inputMappingExample')}
              </p>
            </div>
            <div>
              <Button
                id="service-request-workflow-config-save"
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
                      toast.error(t('messages.error.workflowMappingNotObject'));
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
                    toast.success(t('messages.success.workflowConfigurationUpdated'));
                  } catch (error) {
                    console.error('Failed to update workflow configuration', error);
                    toast.error(t('messages.error.workflowConfigurationInvalid'));
                  }
                }}
              >
                {t('editor.execution.workflow.save')}
              </Button>
            </div>
          </div>
        )}
        {data.execution.showAdvancedFormBehaviorConfigPanel && (
          <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-border-100))]">
            <div className="text-sm font-semibold">{t('editor.execution.advanced.title')}</div>
            <details id="service-request-form-behavior-config-advanced">
              <summary className="cursor-pointer text-sm">
                {t('editor.form.visibility.advancedJson')}
              </summary>
              <div className="mt-2 space-y-1">
                <div className="text-xs text-[rgb(var(--color-text-600))]">
                  {t('editor.form.visibility.advancedJsonHelp')}
                </div>
                <TextArea
                  id="service-request-form-behavior-config"
                  label={t('editor.execution.advanced.config')}
                  wrapperClassName="mb-0"
                  className="min-h-[140px] font-mono"
                  value={formBehaviorConfigDraft ?? savedFormBehaviorConfigText}
                  onChange={(event) => setFormBehaviorConfigDraft(event.target.value)}
                />
                <div>
                  <Button
                    id="service-request-form-behavior-config-save"
                    disabled={formBehaviorConfigDraft === null}
                    onClick={async () => {
                      if (formBehaviorConfigDraft === null) return;
                      let parsed: unknown;
                      try {
                        parsed = formBehaviorConfigDraft.trim() ? JSON.parse(formBehaviorConfigDraft) : {};
                      } catch {
                        toast.error(t('messages.error.formBehaviorInvalid'));
                        return;
                      }
                      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        toast.error(t('messages.error.formBehaviorNotObject'));
                        return;
                      }
                      try {
                        await updateServiceRequestFormBehaviorConfigAction(
                          data.definitionId,
                          parsed as Record<string, unknown>
                        );
                        setFormBehaviorConfigDraft(null);
                        await reloadDefinitionEditorState(data.definitionId);
                        toast.success(t('messages.success.formBehaviorConfigUpdated'));
                      } catch (error) {
                        console.error('Failed to update form behavior config', error);
                        toast.error(t('messages.error.formBehaviorInvalid'));
                      }
                    }}
                  >
                    {t('editor.execution.advanced.save')}
                  </Button>
                </div>
              </div>
            </details>
          </div>
        )}
        <div className="space-y-3 rounded border p-3 bg-[rgb(var(--color-border-100))]">
          <div className="text-sm font-semibold">{t('editor.execution.visibility.title')}</div>
          <ServiceRequestAudienceEditor
            definitionId={data.definitionId}
            initialAudience={data.execution.audience}
            removedReferences={data.execution.removedAudienceReferences}
            onChange={setAudienceDraft}
            onSaved={() => reloadDefinitionEditorState(data.definitionId)}
          />

        </div>
        <FieldRow label={t('editor.execution.fields.executionProvider')} value={data.execution.executionProvider} />
        <FieldRow label={t('editor.execution.fields.executionConfig')} value={JSON.stringify(data.execution.executionConfig)} />
        <FieldRow label={t('editor.execution.fields.formBehaviorProvider')} value={data.execution.formBehaviorProvider} />
        <FieldRow label={t('editor.execution.fields.visibilityProvider')} value={data.execution.visibilityProvider} />
      </Card>

      <AnswerMappingSection
        definitionId={data.definitionId}
        questions={getSchemaFields(data.form.schema)
          .filter((field) => getFieldElementKind(field.type) === 'input')
          .map((field) => ({
            key: field.key,
            label: field.label || field.key,
          }))}
        t={t}
        formatDate={formatDate}
      />

      <Card id="service-request-editor-publish" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">{t('editor.publishSection.title')}</h2>
        <FieldRow label={t('editor.publishSection.currentDraftState')} value={draftLifecycleLabel ?? '-'} />
        <FieldRow
          label={t('editor.publishSection.lastPublishedVersion')}
          value={
            data.publish.publishedVersionNumber
              ? t('editor.publishSection.versionPrefix', { number: data.publish.publishedVersionNumber })
              : t('editor.publishSection.neverPublished')
          }
        />
        <FieldRow
          label={t('editor.publishSection.publishedAt')}
          value={data.publish.publishedAt ? formatDate(new Date(data.publish.publishedAt), { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
        />
        <FieldRow label={t('editor.publishSection.draftUpdatedAt')} value={formatDate(new Date(data.publish.draftUpdatedAt), { dateStyle: 'medium', timeStyle: 'short' })} />
        {validationErrors.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>{t('editor.publishSection.validationTitle')}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {validationErrors.map((error) => (
                  <li key={error}>{translateValidationError(error, t)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="success">
            <AlertDescription>{t('editor.publishSection.validationPassed')}</AlertDescription>
          </Alert>
        )}
      </Card>

      <Card id="service-request-editor-submissions" className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">{t('editor.submissions.title')}</h2>
        {submissions.length === 0 ? (
          <div className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.submissions.empty')}</div>
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
                    {t('editor.submissions.submittedAtStatus', {
                      date: formatDate(new Date(submission.submitted_at), { dateStyle: 'medium', timeStyle: 'short' }),
                      status: submission.execution_status,
                    })}
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
                  {t('editor.submissions.viewDetail')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {selectedSubmissionDetail && (
          <div className="rounded border p-3 bg-[rgb(var(--color-border-100))] space-y-2">
            <div className="text-sm font-semibold">{t('editor.submissions.detailTitle')}</div>
            <FieldRow label={t('editor.submissions.submissionId')} value={selectedSubmissionDetail.submission_id} />
            <FieldRow
              label={t('editor.submissions.formVersion')}
              value={t('editor.submissions.formVersionValue', {
                version: selectedSubmissionDetail.definition_version_number,
              })}
            />
            <FieldRow
              label={t('editor.submissions.requesterUser')}
              value={
                selectedSubmissionDetail.requester_user_name ??
                selectedSubmissionDetail.requester_user_id ??
                '-'
              }
            />
            <FieldRow
              label={t('editor.submissions.client')}
              value={selectedSubmissionDetail.client_name ?? selectedSubmissionDetail.client_id ?? '-'}
            />
            <FieldRow
              label={t('editor.submissions.contact')}
              value={selectedSubmissionDetail.contact_name ?? selectedSubmissionDetail.contact_id ?? '-'}
            />
            <FieldRow
              label={t('editor.submissions.ticketReference')}
              value={
                selectedSubmissionDetail.created_ticket_id ? (
                  <Button
                    id={`service-request-submission-ticket-${selectedSubmissionDetail.submission_id}`}
                    type="button"
                    variant="ghost"
                    className="h-auto p-0 text-[rgb(var(--color-primary-600))] hover:bg-transparent hover:underline"
                    onClick={() => openTicketDrawer(selectedSubmissionDetail.created_ticket_id)}
                  >
                    {selectedSubmissionDetail.created_ticket_display ?? selectedSubmissionDetail.created_ticket_id}
                  </Button>
                ) : (
                  '-'
                )
              }
            />
            <FieldRow label={t('editor.submissions.workflowReference')} value={selectedSubmissionDetail.workflow_execution_id ?? '-'} />
            <FieldRow
              label={t('editor.submissions.executionError')}
              value={selectedSubmissionDetail.execution_error_summary ?? '-'}
            />
            <SubmissionMappingPanel
              definitionId={definitionId}
              submissionId={selectedSubmissionDetail.submission_id}
              questionLabel={(key) => {
                if (!key) return t('editor.submissions.mapping.emptyValue');
                const field = getSchemaFields(data.form.schema).find((candidate) => candidate.key === key);
                return field?.label || t('editor.answerMapping.unknownQuestion', { key });
              }}
              t={t}
              formatDate={formatDate}
              onApplied={async () => {
                const detail = await getServiceRequestDefinitionSubmissionDetailAction(
                  definitionId,
                  selectedSubmissionDetail.submission_id
                );
                setSelectedSubmissionDetail(detail as DefinitionSubmissionDetail | null);
              }}
            />
            <div className="pt-2">
              <div className="text-sm font-semibold">{t('editor.submissions.historyTitle')}</div>
              {selectedSubmissionDetail.audit_events.length === 0 ? (
                <div className="text-sm text-[rgb(var(--color-text-600))]">
                  {t('editor.submissions.historyEmpty')}
                </div>
              ) : (
                <ol className="mt-1 space-y-1">
                  {selectedSubmissionDetail.audit_events.map((event) => (
                    <li key={event.audit_id} className="text-sm">
                      <span className="font-medium">
                        {t(`editor.submissions.historyOperations.${event.operation}`, {
                          defaultValue: event.operation,
                        })}
                      </span>
                      <span className="text-[rgb(var(--color-text-600))]">
                        {' · '}
                        {formatDate(new Date(event.timestamp), { dateStyle: 'medium', timeStyle: 'short' })}
                        {event.actor_name
                          ? ` · ${t('editor.submissions.historyActor', { actor: event.actor_name })}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <pre className="text-xs bg-white p-2 rounded overflow-auto">
              {JSON.stringify(selectedSubmissionDetail.submitted_payload, null, 2)}
            </pre>
          </div>
        )}
      </Card>

        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <Card
            id="service-request-editor-preview"
            className="border-dashed border-2 border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-border-50))] p-0 overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-dashed border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-border-100))] px-4 py-2">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[rgb(var(--color-text-600))]">
                  {t('editor.preview.title')}
                </h2>
              </div>
              <span className="chip-primary rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                {t('editor.preview.badge')}
              </span>
            </div>

            <div className="space-y-6 p-5" aria-hidden="true">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                  {t('editor.preview.cardSubheading')}
                </div>
                <ServiceRequestCard
                  title={data.basics.name}
                  description={data.basics.description}
                  icon={data.basics.icon}
                  categoryLabel={data.basics.categoryName ?? data.basics.categoryId ?? t('editor.basics.uncategorized')}
                  fallbackCategory={t('editor.basics.uncategorized')}
                  noDescription={t('editor.linkage.noDescription')}
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                  {t('editor.preview.formSubheading')}
                </div>
                <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-md">
                  <div className="flex items-center gap-1.5 border-b border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--color-accent-400))]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--color-status-warning))]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--color-status-success))]" />
                  </div>
                  <div className="p-4 pointer-events-none select-none">
                    {getSchemaFields(data.form.schema).length > 0 ? (
                      /* The real portal renderer, so this preview cannot drift from the form. */
                      <ServiceRequestFormRenderer
                        fields={normalizeBasicFormSchema(data.form.schema).fields}
                        settings={normalizeBasicFormSchema(data.form.schema).settings}
                        values={{}}
                        onValueChange={() => {}}
                        disabled
                        idPrefix="service-request-editor-preview-field"
                        labels={{
                          selectPlaceholder: t('editor.form.selectOption'),
                          datePlaceholder: t('editor.form.datePlaceholder'),
                        }}
                      />
                    ) : (
                      <p className="text-sm text-[rgb(var(--color-text-600))]">{t('editor.form.noFields')}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
