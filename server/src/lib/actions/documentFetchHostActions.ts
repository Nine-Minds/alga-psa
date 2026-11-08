'use server';

/**
 * Server actions behind Settings > MCP Server > "Allowed download hosts".
 * Thin wrappers: the permission check, validation and the in-transaction audit row live
 * in `lib/api/services/documents/fetchHostSettings.ts`. There is deliberately no REST or
 * MCP surface for this list; admins manage it in the web UI.
 */
import { withAuth } from '@alga-psa/auth/withAuth';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  addCustomFetchHost,
  disableBuiltinFetchHost,
  enableBuiltinFetchHost,
  listFetchHostSettings,
  removeCustomFetchHost,
  type FetchHostResult,
  type FetchHostSettingsView,
} from '@/lib/api/services/documents/fetchHostSettings';

async function ctxFor(user: IUserWithRoles, tenant: string) {
  const { knex } = await createTenantKnex();
  return { knex, tenant, user };
}

export const listDocumentFetchHosts = withAuth(
  async (user, { tenant }): Promise<FetchHostResult<{ settings: FetchHostSettingsView }>> =>
    listFetchHostSettings(await ctxFor(user, tenant)),
);

export const addDocumentFetchHost = withAuth(
  async (user, { tenant }, input: { hostPattern: string; note?: string | null }) =>
    addCustomFetchHost(await ctxFor(user, tenant), input),
);

export const removeDocumentFetchHost = withAuth(async (user, { tenant }, entryId: string) =>
  removeCustomFetchHost(await ctxFor(user, tenant), entryId),
);

export const disableBuiltinDocumentFetchHost = withAuth(async (user, { tenant }, pattern: string) =>
  disableBuiltinFetchHost(await ctxFor(user, tenant), pattern),
);

export const enableBuiltinDocumentFetchHost = withAuth(async (user, { tenant }, pattern: string) =>
  enableBuiltinFetchHost(await ctxFor(user, tenant), pattern),
);
