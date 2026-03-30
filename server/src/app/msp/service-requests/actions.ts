'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getAllBoards, getAllPriorities, getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import { getTicketCategoriesByBoard } from '@alga-psa/tickets/actions';
import {
  addBasicFormFieldToDefinitionDraft,
  archiveServiceRequestDefinitionFromManagement,
  createBlankServiceRequestDefinition,
  createServiceRequestDefinitionFromTemplate,
  duplicateServiceRequestDefinition,
  type BasicFormFieldType,
  listServiceRequestDefinitionsForManagement,
  listServiceRequestTemplateOptions,
  removeBasicFormFieldFromDefinitionDraft,
  reorderBasicFormFieldsInDefinitionDraft,
  unarchiveServiceRequestDefinitionFromManagement,
  getServiceRequestDefinitionEditorData,
  publishServiceRequestDefinitionWithValidation,
  saveServiceRequestDefinitionDraft,
  searchServiceCatalogForLinking,
  setLinkedServiceForServiceRequestDefinitionDraft,
  updateBasicFormFieldInDefinitionDraft,
  listServiceRequestSubmissionsForDefinition,
  getServiceRequestSubmissionDetailForDefinition,
  validateServiceRequestDefinitionForPublish,
  type LinkableServiceOption,
  type ServiceRequestAdminDefinitionSubmissionDetail,
  type ServiceRequestAdminDefinitionSubmissionRow,
  type ServiceRequestDefinitionManagementRow,
  type ServiceRequestPublishValidationResult,
  type ServiceRequestTemplateOption,
  type ServiceRequestDefinitionEditorData,
} from '../../../lib/service-requests';
import type { IBoard, IPriority, ITicketCategory, ITicketStatus, IUser } from '@alga-psa/types';

type AuthUser = Parameters<Parameters<typeof withAuth>[0]>[0];

function getActorId(user: unknown): string | null {
  const candidate = user as { user_id?: string; id?: string } | undefined;
  return candidate?.user_id ?? candidate?.id ?? null;
}

function throwHttpError(status: number, message: string): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
}

async function requireServiceRequestPermission(
  user: AuthUser,
  action: 'create' | 'read' | 'update' | 'delete',
  knex?: Awaited<ReturnType<typeof createTenantKnex>>['knex']
): Promise<void> {
  if ((user as { user_type?: string }).user_type === 'client') {
    throwHttpError(403, 'MSP user required');
  }

  const allowed = await hasPermission(user, 'service', action, knex);
  if (!allowed) {
    throwHttpError(403, `Service permission "${action}" required`);
  }
}

export const listServiceRequestDefinitionsAction = withAuth(async (
  user,
  { tenant }
): Promise<ServiceRequestDefinitionManagementRow[]> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  return listServiceRequestDefinitionsForManagement(knex, tenant);
});

export const listServiceRequestTemplatesAction = withAuth(async (
  user
): Promise<
  ServiceRequestTemplateOption[]
> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  return listServiceRequestTemplateOptions();
});

export const getServiceRequestDefinitionEditorDataAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<ServiceRequestDefinitionEditorData | null> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  return getServiceRequestDefinitionEditorData(knex, tenant, definitionId);
});

export interface ServiceRequestTicketRoutingReferenceData {
  boards: IBoard[];
  priorities: IPriority[];
  users: IUser[];
}

export interface ServiceRequestTicketRoutingBoardData {
  statuses: ITicketStatus[];
  categories: ITicketCategory[];
  boardConfig: {
    category_type: 'custom' | 'itil';
    priority_type: 'custom' | 'itil';
    display_itil_impact?: boolean;
    display_itil_urgency?: boolean;
  } | null;
}

export const getServiceRequestTicketRoutingReferenceDataAction = withAuth(async (
  user
): Promise<ServiceRequestTicketRoutingReferenceData> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);

  const [boards, priorities, users] = await Promise.all([
    getAllBoards(true),
    getAllPriorities('ticket'),
    getAllUsersBasic(false, 'internal'),
  ]);

  return {
    boards,
    priorities,
    users,
  };
});

export const getServiceRequestTicketRoutingBoardDataAction = withAuth(async (
  user,
  _ctx,
  boardId: string
): Promise<ServiceRequestTicketRoutingBoardData> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);

  if (!boardId || boardId.trim().length === 0) {
    return {
      statuses: [],
      categories: [],
      boardConfig: null,
    };
  }

  const [statuses, boardCategoryData] = await Promise.all([
    getTicketStatuses(boardId),
    getTicketCategoriesByBoard(boardId),
  ]);

  return {
    statuses,
    categories: boardCategoryData.categories,
    boardConfig: boardCategoryData.boardConfig,
  };
});

export const createBlankServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  name?: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'create', knex);
  return createBlankServiceRequestDefinition({
    knex,
    tenant,
    name,
    createdBy: getActorId(user),
  });
});

export const createServiceRequestDefinitionFromTemplateAction = withAuth(async (
  user,
  { tenant },
  templateProviderKey: string,
  templateId: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'create', knex);
  return createServiceRequestDefinitionFromTemplate({
    knex,
    tenant,
    templateProviderKey,
    templateId,
    createdBy: getActorId(user),
  });
});

export const duplicateServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'create', knex);
  return duplicateServiceRequestDefinition({
    knex,
    tenant,
    sourceDefinitionId: definitionId,
    createdBy: getActorId(user),
  });
});

export const saveServiceRequestDefinitionDraftAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {},
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestExecutionProviderAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  executionProvider: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {
      execution_provider: executionProvider,
    },
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestExecutionConfigAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  executionConfig: Record<string, unknown>
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {
      execution_config: executionConfig,
    },
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestBasicsAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  basics: {
    name: string;
    description: string | null;
    icon: string | null;
    categoryId: string | null;
    sortOrder: number;
  }
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {
      name: basics.name.trim(),
      description: basics.description,
      icon: basics.icon,
      category_id: basics.categoryId,
      sort_order: basics.sortOrder,
    },
    updatedBy: getActorId(user),
  });
});

export const addServiceRequestFormFieldAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  fieldType: BasicFormFieldType
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return addBasicFormFieldToDefinitionDraft({
    knex,
    tenant,
    definitionId,
    field: {
      type: fieldType,
      label: `New ${fieldType} field`,
      required: false,
      helpText: null,
    },
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestFormFieldAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  fieldKey: string,
  updates: {
    label?: string;
    helpText?: string | null;
    required?: boolean;
    defaultValue?: string | boolean | null;
    options?: Array<{ label: string; value: string }>;
  }
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return updateBasicFormFieldInDefinitionDraft({
    knex,
    tenant,
    definitionId,
    fieldKey,
    updates,
    updatedBy: getActorId(user),
  });
});

export const removeServiceRequestFormFieldAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  fieldKey: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return removeBasicFormFieldFromDefinitionDraft({
    knex,
    tenant,
    definitionId,
    fieldKey,
    updatedBy: getActorId(user),
  });
});

export const reorderServiceRequestFormFieldsAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  orderedFieldKeys: string[]
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return reorderBasicFormFieldsInDefinitionDraft({
    knex,
    tenant,
    definitionId,
    orderedFieldKeys,
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestFormBehaviorProviderAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  formBehaviorProvider: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {
      form_behavior_provider: formBehaviorProvider,
    },
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestFormBehaviorConfigAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  formBehaviorConfig: Record<string, unknown>
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {
      form_behavior_config: formBehaviorConfig,
    },
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestVisibilityProviderAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  visibilityProvider: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {
      visibility_provider: visibilityProvider,
    },
    updatedBy: getActorId(user),
  });
});

export const updateServiceRequestVisibilityConfigAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  visibilityConfig: Record<string, unknown>
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {
      visibility_config: visibilityConfig,
    },
    updatedBy: getActorId(user),
  });
});

export const validateServiceRequestDefinitionForPublishAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<ServiceRequestPublishValidationResult> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return validateServiceRequestDefinitionForPublish(knex, tenant, definitionId);
});

export const publishServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
) => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return publishServiceRequestDefinitionWithValidation({
    knex,
    tenant,
    definitionId,
    publishedBy: getActorId(user),
  });
});

export const searchLinkedServicesForDefinitionAction = withAuth(async (
  user,
  { tenant },
  query: string
): Promise<LinkableServiceOption[]> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  return searchServiceCatalogForLinking(knex, tenant, query);
});

export const setLinkedServiceForDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  linkedServiceId: string | null
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  return setLinkedServiceForServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    linkedServiceId,
    updatedBy: getActorId(user),
  });
});

export const listServiceRequestDefinitionSubmissionsAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<ServiceRequestAdminDefinitionSubmissionRow[]> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  return listServiceRequestSubmissionsForDefinition(knex, tenant, definitionId);
});

export const getServiceRequestDefinitionSubmissionDetailAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  submissionId: string
): Promise<ServiceRequestAdminDefinitionSubmissionDetail | null> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'read', knex);
  return getServiceRequestSubmissionDetailForDefinition(knex, tenant, definitionId, submissionId);
});

export const archiveServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'delete', knex);
  await archiveServiceRequestDefinitionFromManagement(knex, tenant, definitionId, getActorId(user));
});

export const unarchiveServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();
  await requireServiceRequestPermission(user, 'update', knex);
  await unarchiveServiceRequestDefinitionFromManagement(knex, tenant, definitionId, getActorId(user));
});
