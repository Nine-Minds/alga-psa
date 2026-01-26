/**
 * @alga-psa/projects
 *
 * Project management module for Alga PSA.
 * Provides project CRUD operations, task management, and project tracking.
 */

// Models
export { ProjectModel } from './models';

// Components
export * from './components';

// Re-export project types from @alga-psa/types
export type {
  IProject,
  IProjectPhase,
  IProjectTask,
  IProjectTaskCardInfo,
  IProjectTicketLink,
  IProjectTicketLinkWithDetails,
  ITaskChecklistItem,
  IProjectStatusMapping,
  IProjectTaskDependency,
  ITaskType,
  IStandardTaskType,
  ICustomTaskType,
  IClientPortalConfig,
  ProjectStatus,
  DependencyType,
  ItemType,
} from '@alga-psa/types';

export {
  DEFAULT_CLIENT_PORTAL_CONFIG,
  CONFIGURABLE_TASK_FIELDS,
} from '@alga-psa/types';

// Note: This module contains:
// - Project CRUD operations (ProjectModel - migrated)
// - Task management
// - Project phases and milestones
// - Time tracking per project
// - 50+ project components (migrated)
