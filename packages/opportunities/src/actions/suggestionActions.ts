'use server';

import { createTenantKnex } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type {
  IOpportunity,
  IOpportunitySuggestion,
  OpportunitySuggestionStatus,
} from '@alga-psa/types';
import {
  acceptSuggestionOverridesSchema,
  opportunitySuggestionStatusSchema,
  snoozeSuggestionSchema,
} from '../schemas/opportunitySchemas';
import {
  acceptSuggestionInternal,
  dismissSuggestionInternal,
  listSuggestionsInternal,
  snoozeSuggestionInternal,
} from '../lib/suggestions';

async function requirePermission(user: unknown, action: 'read' | 'update'): Promise<void> {
  if (!await hasPermission(user as any, 'opportunities', action)) {
    throw new Error(`Permission denied: opportunities ${action} required`);
  }
}

function actorId(user: unknown): string {
  const id = (user as { user_id?: string } | null)?.user_id;
  if (!id) throw new Error('user is not logged in');
  return id;
}

export const listSuggestions = withAuth(async (
  user,
  { tenant },
  status?: OpportunitySuggestionStatus,
): Promise<IOpportunitySuggestion[]> => {
  await requirePermission(user, 'read');
  const parsedStatus = status === undefined ? undefined : opportunitySuggestionStatusSchema.parse(status);
  const { knex } = await createTenantKnex();
  return listSuggestionsInternal(knex, tenant, parsedStatus);
});

export const acceptSuggestion = withAuth(async (
  user,
  { tenant },
  suggestionId: string,
  overrides?: unknown,
): Promise<IOpportunity> => {
  await requirePermission(user, 'update');
  const parsed = acceptSuggestionOverridesSchema.parse(overrides ?? {});
  const { knex } = await createTenantKnex();
  return acceptSuggestionInternal(knex, tenant, suggestionId, actorId(user), parsed);
});

export const dismissSuggestion = withAuth(async (
  user,
  { tenant },
  suggestionId: string,
): Promise<IOpportunitySuggestion> => {
  await requirePermission(user, 'update');
  const { knex } = await createTenantKnex();
  return dismissSuggestionInternal(knex, tenant, suggestionId);
});

export const snoozeSuggestion = withAuth(async (
  user,
  { tenant },
  suggestionId: string,
  until: string,
): Promise<IOpportunitySuggestion> => {
  await requirePermission(user, 'update');
  const data = snoozeSuggestionSchema.parse({ snoozed_until: until });
  const { knex } = await createTenantKnex();
  return snoozeSuggestionInternal(knex, tenant, suggestionId, data.snoozed_until);
});
