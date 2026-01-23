'use server'

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { hasPermission } from '@alga-psa/auth/rbac';

export type TicketListColumnKey =
  | 'ticket_number'
  | 'title'
  | 'status'
  | 'priority'
  | 'board'
  | 'category'
  | 'client'
  | 'assigned_to'
  | 'due_date'
  | 'created'
  | 'created_by'
  | 'tags'
  | 'actions';

export type TicketListSettings = {
  columnVisibility?: Partial<Record<TicketListColumnKey, boolean>>;
  tagsInlineUnderTitle?: boolean;
};

export type TicketingDisplaySettings = {
  dateTimeFormat?: string; // date-fns format string, e.g. 'MMM d, yyyy h:mm a'
  list?: TicketListSettings;
};

const DEFAULT_TICKETING_DATETIME_FORMAT = 'MMM d, yyyy h:mm a';

export async function getTicketingDisplaySettings(): Promise<TicketingDisplaySettings> {
  // Prefer dedicated column if present; fallback to nested settings for backward compatibility
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error('User not authenticated');

    const { knex, tenant } = await createTenantKnex(currentUser.tenant);
    if (!tenant) throw new Error('Tenant not found');
    const row = await knex('tenant_settings').select('ticket_display_settings', 'settings').where({ tenant }).first();
    const fromColumn = (row?.ticket_display_settings as any) || {};
    const nested = ((row?.settings as any)?.ticketing?.display) || {};
    const display = Object.keys(fromColumn).length ? fromColumn : nested;

    return {
      dateTimeFormat: display.dateTimeFormat || DEFAULT_TICKETING_DATETIME_FORMAT,
      list: {
        columnVisibility: {
          ticket_number: display?.list?.columnVisibility?.ticket_number ?? true,
          title: display?.list?.columnVisibility?.title ?? true,
          status: display?.list?.columnVisibility?.status ?? true,
          priority: display?.list?.columnVisibility?.priority ?? true,
          board: display?.list?.columnVisibility?.board ?? true,
          category: display?.list?.columnVisibility?.category ?? true,
          client: display?.list?.columnVisibility?.client ?? true,
          assigned_to: display?.list?.columnVisibility?.assigned_to ?? true,
          due_date: display?.list?.columnVisibility?.due_date ?? true,
          created: display?.list?.columnVisibility?.created ?? true,
          created_by: display?.list?.columnVisibility?.created_by ?? true,
          tags: display?.list?.columnVisibility?.tags ?? true,
          actions: display?.list?.columnVisibility?.actions ?? true,
        },
        tagsInlineUnderTitle: display?.list?.tagsInlineUnderTitle ?? false,
      },
    };
  } catch (e) {
    // As a last resort return defaults
    return {
      dateTimeFormat: DEFAULT_TICKETING_DATETIME_FORMAT,
      list: {
        columnVisibility: {
          ticket_number: true,
          title: true,
          status: true,
          priority: true,
          board: true,
          category: true,
          client: true,
          assigned_to: true,
          due_date: true,
          created: true,
          created_by: true,
          tags: true,
          actions: true,
        },
        tagsInlineUnderTitle: false,
      },
    };
  }
}

export async function updateTicketingDisplaySettings(updated: TicketingDisplaySettings): Promise<{ success: boolean }>{
  // Check permission first
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  
  // Check if user has permission to update ticket settings
  if (!await hasPermission(currentUser, 'ticket_settings', 'update', knex)) {
    throw new Error('Permission denied: Cannot update ticket settings');
  }
  
  if (!tenant) throw new Error('Tenant not found');

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
}

// Do not export non-async values from a "use server" module
