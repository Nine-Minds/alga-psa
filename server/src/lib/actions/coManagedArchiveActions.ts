'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { getCoManagedArchiveHistory, isCoManagedSharedWorkError, listCoManagedArchives,
  type CoManagedArchiveHistory, type CoManagedArchiveSummary } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

// The archive is the MSP's own retained participation evidence. It gates on `serves` (not `admits`)
// so it stays readable after the relationship ends and after the licence lapses. Read-only: there are
// no write actions on an archive.

export type CoManagedArchiveListResult =
  | { ok: true; items: CoManagedArchiveSummary[]; nextPage: number | null }
  | { ok: false; reason: 'denied' };
export type CoManagedArchiveHistoryResult = { ok: true; history: CoManagedArchiveHistory } | { ok: false; reason: 'denied' };

export const listCoManagedArchiveSummaries = withAuth(async (user, { tenant }, page: number = 0): Promise<CoManagedArchiveListResult> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  try {
    const result = await listCoManagedArchives(knex, await coManagedBrowserActor(user, tenant), page);
    return { ok: true, ...result };
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return { ok: false, reason: 'denied' };
    throw error;
  }
});

export const getCoManagedArchive = withAuth(async (user, { tenant }, input: { operationId: string; page?: number }): Promise<CoManagedArchiveHistoryResult> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  if (user.user_type !== 'internal') return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  try {
    return { ok: true, history: await getCoManagedArchiveHistory(knex, await coManagedBrowserActor(user, tenant), input.operationId, input.page ?? 0) };
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return { ok: false, reason: 'denied' };
    throw error;
  }
});
