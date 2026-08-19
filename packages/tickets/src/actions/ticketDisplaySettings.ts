'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { resolveTicketColumnVisibility } from '../lib/ticketColumnCatalog';
import type { TicketViewSettings } from '../lib/ticketViewSettings';

/**
 * The tenant layer of a ticket-list view is the *same document* a board stores.
 *
 * `list` widens from the two keys it used to hold (columnVisibility,
 * tagsInlineUnderTitle) to the full TicketViewSettings — a pure type widening,
 * because both keys already sat at exactly this path. No tenant JSON migration
 * is needed: the type grows, stored data does not move. A board stores the same
 * document *directly* in boards.list_view_settings rather than nested under
 * `list`, because a board has no other display settings to nest beside it.
 */
export type TicketListSettings = TicketViewSettings;

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
    const row = await tenantDb(knex, tenant)
      .table('tenant_settings')
      .select('ticket_display_settings', 'settings')
      .first();
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
        // Carried through unresolved: resolveTicketViewSettings layers the board
        // document over this one and only then applies catalog/step defaults, so
        // "the tenant did not express a density" must stay distinguishable here
        // from "the tenant chose 50".
        columnOrder: display?.list?.columnOrder,
        densityLevel: display?.list?.densityLevel,
        filters: display?.list?.filters,
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

/**
 * Whether the caller may author default views (`ticket_settings:update`).
 *
 * Purely for hiding the save/reset items in the `View ▾` menu — the actions
 * themselves are gated server-side, so this is presentation, not enforcement.
 * A separate read rather than an inference from the settings payload, because
 * "can see the display settings" and "can change them for everyone" are
 * genuinely different questions.
 */
export const canManageTicketViewDefaults = withAuth(async (user, _ctx): Promise<boolean> => {
  const { knex } = await createTenantKnex();
  return hasPermission(user, 'ticket_settings', 'update', knex);
});

export const updateTicketingDisplaySettings = withAuth(async (user, { tenant }, updated: TicketingDisplaySettings): Promise<{ success: boolean } | ActionPermissionError> => {
  const { knex } = await createTenantKnex();

  // Check if user has permission to update ticket settings
  if (!await hasPermission(user, 'ticket_settings', 'update', knex)) {
    return permissionError('Permission denied: Cannot update ticket settings');
  }

  // Read existing values for both the dedicated column and the legacy nested settings path.
  const existingRow = await tenantDb(knex, tenant)
    .table('tenant_settings')
    .select('ticket_display_settings', 'settings')
    .first();

  const currentDisplay = (existingRow?.ticket_display_settings as any) || {};

  // `list` merges key-group-wise; everything else still replaces wholesale.
  //
  // This mattered the moment `list` widened from two keys to the full
  // TicketViewSettings, because it now has two writers that own different
  // subsets of it: Settings → Display authors columnVisibility +
  // tagsInlineUnderTitle, while `View ▾` → "save as default" authors the whole
  // document (columnOrder, densityLevel, filters included). Replacing `list`
  // wholesale meant whichever screen saved last silently deleted the other's
  // keys — save a tenant default view, then change anything in Display
  // Settings, and the tenant's column order, density and filters were gone with
  // no error and no way to tell. Before the widening both writers happened to
  // send the same two keys, so replacement was lossless; it no longer is.
  //
  // A writer therefore replaces the groups it names and leaves the rest alone,
  // which is the same group-level rule the board→tenant resolver already uses.
  const mergedList = updated.list
    ? { ...(currentDisplay.list || {}), ...updated.list }
    : currentDisplay.list;

  const mergedDisplay = {
    ...currentDisplay,
    ...updated,
    ...(mergedList ? { list: mergedList } : {}),
  };

  const rootSettings = (existingRow?.settings as any) || {};
  const ticketing = rootSettings.ticketing || {};
  const display = ticketing.display || {};
  // Same group-level rule on the legacy nested copy, so the two paths cannot
  // disagree about what a partial write means.
  const mergedNestedList = updated.list
    ? { ...(display.list || {}), ...updated.list }
    : display.list;
  const mergedSettings = {
    ...rootSettings,
    ticketing: {
      ...ticketing,
      display: {
        ...display,
        ...updated,
        ...(mergedNestedList ? { list: mergedNestedList } : {}),
      },
    },
  };

  // Use a literal timestamp for Citus compatibility
  const now = new Date();

  await tenantDb(knex, tenant)
    .table('tenant_settings')
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
