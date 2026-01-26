/**
 * @alga-psa/projects
 *
 * Project management module for Alga PSA.
 * Provides project CRUD operations, task management, and project tracking.
 *
 * Main entry point exports buildable lib/models/schemas/types code only.
 * For runtime code, use:
 * - '@alga-psa/projects/actions' for server actions
 * - '@alga-psa/projects/components' for React components
 */

// Models (buildable - no 'use server' or 'use client' directives)
export { default as ProjectModel } from './models/project';
export { default as ProjectTaskModel } from './models/projectTask';
export { default as TaskTypeModel } from './models/taskType';
export { default as TaskDependencyModel } from './models/taskDependency';

// Lib utilities (buildable)
export * from './lib/orderingUtils';
// Note: orderingService.ts and projectUtils.ts contain 'use server' directive, so they are runtime-only

// Schemas (buildable)
export * from './schemas/project.schemas';
export * from './schemas/projectTemplate.schemas';

// Types (buildable)
export * from './types/templateWizard';

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
