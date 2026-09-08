'use server';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { listCoManagedArchiveWork, getCoManagedArchiveHistory, listCoManagedArchiveFiles, type CoManagedSharedResource } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const listArchiveWorkAction = withAuth(async (user, { tenant }, page = 0) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return listCoManagedArchiveWork(knex, actor, page);
});
export const getArchiveHistoryAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, page = 0) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedArchiveHistory(knex, actor, resource, page);
});
export const listArchiveFilesAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, page = 0) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return listCoManagedArchiveFiles(knex, actor, resource, page);
});
