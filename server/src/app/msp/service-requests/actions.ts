'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import {
  archiveServiceRequestDefinitionFromManagement,
  createBlankServiceRequestDefinition,
  createServiceRequestDefinitionFromTemplate,
  duplicateServiceRequestDefinition,
  listServiceRequestDefinitionsForManagement,
  listServiceRequestTemplateOptions,
  unarchiveServiceRequestDefinitionFromManagement,
  getServiceRequestDefinitionEditorData,
  publishServiceRequestDefinitionWithValidation,
  saveServiceRequestDefinitionDraft,
  searchServiceCatalogForLinking,
  setLinkedServiceForServiceRequestDefinitionDraft,
  validateServiceRequestDefinitionForPublish,
  type LinkableServiceOption,
  type ServiceRequestDefinitionManagementRow,
  type ServiceRequestPublishValidationResult,
  type ServiceRequestTemplateOption,
  type ServiceRequestDefinitionEditorData,
} from '../../../lib/service-requests';

function getActorId(user: unknown): string | null {
  const candidate = user as { user_id?: string; id?: string } | undefined;
  return candidate?.user_id ?? candidate?.id ?? null;
}

export const listServiceRequestDefinitionsAction = withAuth(async (
  _user,
  { tenant }
): Promise<ServiceRequestDefinitionManagementRow[]> => {
  const { knex } = await createTenantKnex();
  return listServiceRequestDefinitionsForManagement(knex, tenant);
});

export const listServiceRequestTemplatesAction = withAuth(async (): Promise<
  ServiceRequestTemplateOption[]
> => {
  return listServiceRequestTemplateOptions();
});

export const getServiceRequestDefinitionEditorDataAction = withAuth(async (
  _user,
  { tenant },
  definitionId: string
): Promise<ServiceRequestDefinitionEditorData | null> => {
  const { knex } = await createTenantKnex();
  return getServiceRequestDefinitionEditorData(knex, tenant, definitionId);
});

export const createBlankServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  name?: string
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
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
  return saveServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    updates: {},
    updatedBy: getActorId(user),
  });
});

export const validateServiceRequestDefinitionForPublishAction = withAuth(async (
  _user,
  { tenant },
  definitionId: string
): Promise<ServiceRequestPublishValidationResult> => {
  const { knex } = await createTenantKnex();
  return validateServiceRequestDefinitionForPublish(knex, tenant, definitionId);
});

export const publishServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
) => {
  const { knex } = await createTenantKnex();
  return publishServiceRequestDefinitionWithValidation({
    knex,
    tenant,
    definitionId,
    publishedBy: getActorId(user),
  });
});

export const searchLinkedServicesForDefinitionAction = withAuth(async (
  _user,
  { tenant },
  query: string
): Promise<LinkableServiceOption[]> => {
  const { knex } = await createTenantKnex();
  return searchServiceCatalogForLinking(knex, tenant, query);
});

export const setLinkedServiceForDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string,
  linkedServiceId: string | null
): Promise<ServiceRequestDefinitionManagementRow> => {
  const { knex } = await createTenantKnex();
  return setLinkedServiceForServiceRequestDefinitionDraft({
    knex,
    tenant,
    definitionId,
    linkedServiceId,
    updatedBy: getActorId(user),
  });
});

export const archiveServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();
  await archiveServiceRequestDefinitionFromManagement(knex, tenant, definitionId, getActorId(user));
});

export const unarchiveServiceRequestDefinitionAction = withAuth(async (
  user,
  { tenant },
  definitionId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();
  await unarchiveServiceRequestDefinitionFromManagement(knex, tenant, definitionId, getActorId(user));
});
