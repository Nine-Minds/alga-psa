'use server';

import { withOptionalAuth } from '@alga-psa/auth';
import {
  getContactAvatarUrlAction,
  getUserAvatarUrlsBatchAction,
} from '@alga-psa/user-composition/actions/avatarActions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions/team-actions/avatarActions';

/**
 * Avatar reads for the native ticket screen (`nativeTicketDataSource.avatars`).
 *
 * The shared avatar actions take the tenant from the caller and check nothing.
 * The ticket screen passes `ticket.tenant`, and a ticket supplied by another
 * data source can belong to a different tenant. These wrappers keep the same
 * `(ids, tenant)` signature, so the seam and the pickers that receive them are
 * unchanged, but they answer only for the signed-in user's own tenant. A
 * foreign tenant, or no session, gets no avatars rather than another tenant's
 * documents.
 */
export const getTicketUserAvatarUrlsBatch = withOptionalAuth(
  async (_user, ctx, userIds: string[], tenant: string): Promise<Map<string, string | null>> => {
    if (!ctx?.tenant || tenant !== ctx.tenant) {
      return new Map();
    }
    return getUserAvatarUrlsBatchAction(userIds, ctx.tenant);
  },
);

export const getTicketTeamAvatarUrlsBatch = withOptionalAuth(
  async (_user, ctx, teamIds: string[], tenant: string): Promise<Map<string, string | null>> => {
    if (!ctx?.tenant || tenant !== ctx.tenant) {
      return new Map();
    }
    return getTeamAvatarUrlsBatchAction(teamIds, ctx.tenant);
  },
);

export const getTicketContactAvatarUrl = withOptionalAuth(
  async (_user, ctx, contactId: string, tenant: string): Promise<string | null> => {
    if (!ctx?.tenant || tenant !== ctx.tenant) {
      return null;
    }
    return getContactAvatarUrlAction(contactId, ctx.tenant);
  },
);
