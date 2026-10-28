'use server'

import type { Knex } from 'knex';
import type { IUserWithRoles, ITagDisplayRule, TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import TagDisplayRule from '../models/tagDisplayRule';
import { hasPermissionAsync } from '../lib/authHelpers';
import { isTagDisplayAudience, isTagDisplayEntityType } from '../lib/tagDisplayRules';
import type { TagActionError } from './tagActionErrors';

/**
 * Display rules say which tags show as chips next to contacts and clients, per audience.
 * Reads are for internal users (they configure and render chips); writes need settings:update.
 */

export const listTagDisplayRules = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  taggedType?: TagDisplayEntityType,
): Promise<ITagDisplayRule[] | TagActionError> => {
  if (user.user_type !== 'internal') return permissionError('Permission denied: display rules are not available');
  if (taggedType !== undefined && !isTagDisplayEntityType(taggedType)) return actionError('Unknown entity type');

  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx: Knex.Transaction) => TagDisplayRule.list(trx, tenant, { taggedType }));
});

export const replaceTagDisplayRules = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  taggedType: TagDisplayEntityType,
  audience: TagDisplayAudience,
  tagIds: string[],
): Promise<ITagDisplayRule[] | TagActionError> => {
  if (!isTagDisplayEntityType(taggedType)) return actionError('Unknown entity type');
  if (!isTagDisplayAudience(audience)) return actionError('Unknown audience');
  if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== 'string')) return actionError('Invalid tag list');

  const { knex } = await createTenantKnex();
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (user.user_type !== 'internal' || !(await hasPermissionAsync(user, 'settings', 'update', trx))) {
        return permissionError('Permission denied: Cannot update display rules');
      }
      return TagDisplayRule.replace(trx, tenant, taggedType, audience, tagIds, user.user_id);
    });
  } catch (error) {
    if (error instanceof Error && /^Unknown (contact|client) tag definition/.test(error.message)) {
      return actionError(error.message);
    }
    throw error;
  }
});
