/**
 * Shared definition of the per-user "hidden kanban columns" preference.
 *
 * The setting is stored in `user_preferences` with a per-project setting name
 * (`project_kanban_hidden_statuses:<projectId>`). Its value is a map of
 * `phase_id -> project_status_mapping_id[]` — the columns a given user has
 * chosen to hide, scoped per phase because each phase can have its own
 * customized status set (and therefore its own mapping ids).
 *
 * This lives outside the React component so server-side deletion paths
 * (project / phase deletion) can reference the exact same setting name and
 * value shape when cleaning up orphaned preferences, without importing client
 * code.
 */
export const PROJECT_KANBAN_HIDDEN_STATUSES_SETTING = 'project_kanban_hidden_statuses';

/** Build the per-project setting name used to store hidden kanban columns. */
export const projectKanbanHiddenStatusesKey = (projectId: string): string =>
  `${PROJECT_KANBAN_HIDDEN_STATUSES_SETTING}:${projectId}`;

/** The persisted value shape: phase_id -> hidden mapping ids. */
export type HiddenKanbanStatusesByPhase = Record<string, string[]>;
