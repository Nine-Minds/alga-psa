/**
 * Shared definition of the per-user "hidden kanban columns" preference.
 *
 * The setting is stored in `user_preferences` with a per-project setting name
 * (`project_kanban_hidden_statuses:<projectId>`). Its value is a flat list of
 * underlying status identities: `standard_status_id` for standard statuses and
 * `status_id` for custom statuses. These identities survive phase
 * customization/reversion, where `project_status_mapping_id` rows are replaced.
 *
 * This lives outside the React component so server-side project deletion can
 * reference the exact same setting name when cleaning up orphaned preferences,
 * without importing client code.
 */
import type { ProjectStatus } from '@alga-psa/types';

export const PROJECT_KANBAN_HIDDEN_STATUSES_SETTING = 'project_kanban_hidden_statuses';

/** Build the per-project setting name used to store hidden kanban columns. */
export const projectKanbanHiddenStatusesKey = (projectId: string): string =>
  `${PROJECT_KANBAN_HIDDEN_STATUSES_SETTING}:${projectId}`;

/** The persisted value shape: hidden status identity ids. */
export type HiddenKanbanStatusIds = string[];

/** The identity under which a status is hidden (see module doc). */
export const getKanbanStatusIdentity = (
  status: Pick<ProjectStatus, 'status_id' | 'is_standard' | 'standard_status_id'>
): string =>
  status.is_standard && status.standard_status_id ? status.standard_status_id : status.status_id;

/** Coerce a persisted preference value to the expected flat string[] shape. */
export const normalizeHiddenStatusIds = (raw: unknown): HiddenKanbanStatusIds =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];

/** Add the identity to the hidden list if absent, remove it if present. */
export const toggleHiddenStatusId = (raw: unknown, statusIdentity: string): HiddenKanbanStatusIds => {
  const current = normalizeHiddenStatusIds(raw);
  return current.includes(statusIdentity)
    ? current.filter((id) => id !== statusIdentity)
    : [...current, statusIdentity];
};
