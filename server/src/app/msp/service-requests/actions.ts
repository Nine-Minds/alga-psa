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
  type ServiceRequestDefinitionManagementRow,
  type ServiceRequestTemplateOption,
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
