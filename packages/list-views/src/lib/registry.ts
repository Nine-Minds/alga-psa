import type { z } from 'zod';
import type { ListViewKey, ListViewSettings } from '@alga-psa/types';
import { buildListViewSettingsSchema } from './settingsSchema';
import { ticketListViewFiltersSchema } from './definitions/tickets';
import { projectListViewFiltersSchema } from './definitions/projects';
import { clientListViewFiltersSchema } from './definitions/clients';
import { contactListViewFiltersSchema } from './definitions/contacts';
import { assetListViewFiltersSchema } from './definitions/assets';

/**
 * The server half of a list's participation in named views: who may read it,
 * what may be written for it, and how older documents are upgraded.
 *
 * The client half (capture / apply / sanitize / differs) is the list's
 * `ListViewAdapter`, which lives with the list screen.
 */
export interface ListViewDefinition {
  listKey: ListViewKey;
  /** Holding this permission is what makes the list — and its shared views — visible. */
  readPermission: { resource: string; action: string };
  /** Strict write schema for the full envelope. */
  settingsSchema: z.ZodTypeAny;
  /** Version written with every save. */
  schemaVersion: number;
  /** Upgrades a document stored under an older `schema_version`. */
  migrate?: (settings: ListViewSettings, fromVersion: number) => ListViewSettings;
}

function define(
  listKey: ListViewKey,
  readPermission: ListViewDefinition['readPermission'],
  filtersSchema: z.ZodTypeAny,
): ListViewDefinition {
  return {
    listKey,
    readPermission,
    settingsSchema: buildListViewSettingsSchema(filtersSchema),
    schemaVersion: 1,
  };
}

const LIST_VIEW_DEFINITIONS: Record<ListViewKey, ListViewDefinition> = {
  tickets: define('tickets', { resource: 'ticket', action: 'read' }, ticketListViewFiltersSchema),
  projects: define('projects', { resource: 'project', action: 'read' }, projectListViewFiltersSchema),
  clients: define('clients', { resource: 'client', action: 'read' }, clientListViewFiltersSchema),
  contacts: define('contacts', { resource: 'contact', action: 'read' }, contactListViewFiltersSchema),
  assets: define('assets', { resource: 'asset', action: 'read' }, assetListViewFiltersSchema),
};

export function isListViewKey(value: unknown): value is ListViewKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIST_VIEW_DEFINITIONS, value);
}

/** The definition for a list key; `null` for anything the registry does not know. */
export function getListViewDefinition(listKey: unknown): ListViewDefinition | null {
  return isListViewKey(listKey) ? LIST_VIEW_DEFINITIONS[listKey] : null;
}

/** Brings a stored document up to the definition's current version. */
export function migrateListViewSettings(
  definition: ListViewDefinition,
  settings: ListViewSettings,
  storedVersion: number,
): ListViewSettings {
  if (storedVersion >= definition.schemaVersion || !definition.migrate) {
    return settings;
  }
  return definition.migrate(settings, storedVersion);
}

/** `user_preferences.setting_name` holding a user's default view for a list. */
export function listViewDefaultPreferenceKey(listKey: ListViewKey): string {
  return `listViews.default.${listKey}`;
}

/** URL query parameter carrying the applied view. */
export const LIST_VIEW_URL_PARAM = 'view';
