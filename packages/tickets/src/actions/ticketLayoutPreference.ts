'use server';

import type { Knex } from 'knex';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, UserPreferences, withTransaction } from '@alga-psa/db';

export type TicketDetailLayout = 'grid' | 'entry';

export interface TicketLayoutPreference {
  layout: TicketDetailLayout;
  timelineOrder: 'asc' | 'desc';
}

const DEFAULT_LAYOUT_PREFERENCE: TicketLayoutPreference = {
  layout: 'entry',
  timelineOrder: 'asc',
};

const LAYOUT_SETTING = 'ticket_detail_layout';
const TIMELINE_ORDER_SETTING = 'ticket_timeline_order';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function assertInternalUser(user: { user_type?: string }): void {
  if (user.user_type === 'client') {
    throw new Error('Permission denied: ticket layout preferences are internal-only in v1');
  }
}

function isTicketDetailLayout(value: unknown): value is TicketDetailLayout {
  return value === 'grid' || value === 'entry';
}

function isTimelineOrder(value: unknown): value is TicketLayoutPreference['timelineOrder'] {
  return value === 'asc' || value === 'desc';
}

function parseStoredPreference(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function assertCurrentUserExists(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<void> {
  const currentUser = await tenantScopedTable(trx, 'users', tenant)
    .where({ user_id: userId })
    .first(['user_id']);
  if (!currentUser) {
    throw new Error('Current user not found');
  }
}

export const getTicketLayoutPreference = withAuth(
  async (
    user,
    { tenant },
  ): Promise<TicketLayoutPreference> => {
    if (!tenant) {
      throw new Error('Tenant required');
    }
    if (!user.user_id) {
      throw new Error('user.user_id required');
    }

    assertInternalUser(user as { user_type?: string });

    const { knex } = await createTenantKnex(tenant);

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertCurrentUserExists(trx, tenant, user.user_id);

      const layoutPreference = await UserPreferences.get(trx, user.user_id, LAYOUT_SETTING);
      const timelineOrderPreference = await UserPreferences.get(trx, user.user_id, TIMELINE_ORDER_SETTING);

      const layoutValue = parseStoredPreference(layoutPreference?.setting_value);
      const timelineOrderValue = parseStoredPreference(timelineOrderPreference?.setting_value);

      return {
        layout: isTicketDetailLayout(layoutValue) ? layoutValue : DEFAULT_LAYOUT_PREFERENCE.layout,
        timelineOrder: isTimelineOrder(timelineOrderValue)
          ? timelineOrderValue
          : DEFAULT_LAYOUT_PREFERENCE.timelineOrder,
      };
    });
  },
);

export const setTicketLayoutPreference = withAuth(
  async (
    user,
    { tenant },
    prefs: Partial<TicketLayoutPreference>,
  ): Promise<{ success: true }> => {
    if (!tenant) {
      throw new Error('Tenant required');
    }
    if (!user.user_id) {
      throw new Error('user.user_id required');
    }

    assertInternalUser(user as { user_type?: string });

    if (prefs.layout !== undefined && !isTicketDetailLayout(prefs.layout)) {
      throw new Error(`Invalid ticket detail layout: ${prefs.layout}`);
    }
    if (prefs.timelineOrder !== undefined && !isTimelineOrder(prefs.timelineOrder)) {
      throw new Error(`Invalid ticket timeline order: ${prefs.timelineOrder}`);
    }

    const { knex } = await createTenantKnex(tenant);

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertCurrentUserExists(trx, tenant, user.user_id);

      if (prefs.layout !== undefined) {
        await UserPreferences.upsert(trx, {
          user_id: user.user_id,
          setting_name: LAYOUT_SETTING,
          setting_value: JSON.stringify(prefs.layout),
          updated_at: new Date(),
        });
      }

      if (prefs.timelineOrder !== undefined) {
        await UserPreferences.upsert(trx, {
          user_id: user.user_id,
          setting_name: TIMELINE_ORDER_SETTING,
          setting_value: JSON.stringify(prefs.timelineOrder),
          updated_at: new Date(),
        });
      }

      return { success: true };
    });
  },
);
