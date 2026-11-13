import { hasPermission } from '@/lib/auth/rbac';
import type { Knex } from 'knex';

export class ProviderMutationForbiddenError extends Error {
  constructor() {
    super('Provider mutation requires an internal user with ticket_settings:update');
    this.name = 'ProviderMutationForbiddenError';
  }
}

/** Shared authority gate for user initiated email-provider mutations. */
export async function assertProviderMutationAuthority(
  user: { user_id: string; user_type?: string; tenant?: string },
  knex: Knex,
): Promise<void> {
  if (user.user_type !== 'internal') throw new ProviderMutationForbiddenError();
  if (!await hasPermission(user as any, 'ticket_settings', 'update', knex)) {
    throw new ProviderMutationForbiddenError();
  }
}
