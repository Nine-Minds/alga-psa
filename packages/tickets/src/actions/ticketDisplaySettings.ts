'use server'

import { createTenantKnex } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth';
import { resolveTicketColumnVisibility, type TicketListColumnKey } from '../lib/ticketColumnCatalog';

export type TicketListSettings = {
  columnVisibility?: Partial<Record<TicketListColumnKey, boolean>>;
  tagsInlineUnderTitle?: boolean;
};

export type TicketingDisplaySettings = {
  dateTimeFormat?: string; // date-fns format string, e.g. 'MMM d, yyyy h:mm a'
  responseStateTrackingEnabled?: boolean; // default true — when false, response state is not tracked or displayed
  list?: TicketListSettings;
};

const DEFAULT_TICKETING_DATETIME_FORMAT = 'MMM d, yyyy h:mm a';

export const getTicketingDisplaySettings = withAuth(async (_user, { tenant }): Promise<TicketingDisplaySettings> => {
  // Prefer dedicated column if present; fallback to nested settings for backward compatibility
  try {
    const { knex } = await createTenantKnex();
    const row = await knex('tenant_settings').select('ticket_display_settings', 'settings').where({ tenant }).first();
    const fromColumn = (row?.ticket_display_settings as any) || {};
    const nested = ((row?.settings as any)?.ticketing?.display) || {};
    const display = Object.keys(fromColumn).length ? fromColumn : nested;

    return {
      dateTimeFormat: display.dateTimeFormat || DEFAULT_TICKETING_DATETIME_FORMAT,
      responseStateTrackingEnabled: display.responseStateTrackingEnabled ?? true,
      list: {
        // Defaults (and the "Refined List" fold behavior) come from the shared
        // ticket-column catalog so this list can't drift from the renderer.
        columnVisibility: resolveTicketColumnVisibility(display?.list?.columnVisibility),
        tagsInlineUnderTitle: display?.list?.tagsInlineUnderTitle ?? true,
      },
    };
  } catch (e) {
    // As a last resort return defaults
    return {
      dateTimeFormat: DEFAULT_TICKETING_DATETIME_FORMAT,
      responseStateTrackingEnabled: true,
      list: {
        columnVisibility: resolveTicketColumnVisibility(),
        tagsInlineUnderTitle: true,
      },
    };
  }
});

export const updateTicketingDisplaySettings = withAuth(async (user, { tenant }, updated: TicketingDisplaySettings): Promise<{ success: boolean }> => {
  const { knex } = await createTenantKnex();

  // Check if user has permission to update ticket settings
  if (!await hasPermission(user, 'ticket_settings', 'update', knex)) {
    throw new Error('Permission denied: Cannot update ticket settings');
  }

  // Read existing values for both the dedicated column and the legacy nested settings path.
  const existingRow = await knex('tenant_settings')
    .select('ticket_display_settings', 'settings')
    .where({ tenant })
    .first();

  const currentDisplay = (existingRow?.ticket_display_settings as any) || {};
  const mergedDisplay = {
    ...currentDisplay,
    ...updated,
  };

  const rootSettings = (existingRow?.settings as any) || {};
  const ticketing = rootSettings.ticketing || {};
  const display = ticketing.display || {};
  const mergedSettings = {
    ...rootSettings,
    ticketing: {
      ...ticketing,
      display: {
        ...display,
        ...updated,
      },
    },
  };

  // Use a literal timestamp for Citus compatibility
  const now = new Date();

  await knex('tenant_settings')
    .insert({
      tenant,
      ticket_display_settings: JSON.stringify(mergedDisplay),
      settings: JSON.stringify(mergedSettings),
      updated_at: now,
    })
    .onConflict('tenant')
    .merge({
      ticket_display_settings: JSON.stringify(mergedDisplay),
      settings: JSON.stringify(mergedSettings),
      updated_at: now,
    });

  return { success: true };
});

// Do not export non-async values from a "use server" module
