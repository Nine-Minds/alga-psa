/**
 * The native ProjectDataSource: today's server actions, unchanged.
 *
 * Every entry is a LAZY forwarder (same shape as nativeTicketDataSource): the action module is
 * loaded on first call and the call is forwarded with its arguments untouched. The singleton makes
 * neutrality structural — a PSA tenant's project screen issues exactly the statements it issued
 * before the seam — and keeps `vi.mock` of the action modules working.
 */
import { NATIVE_PROJECT_SCREEN, type ProjectDataSource } from './projectDataSource';

// LEVERAGE: pattern late-bound-action-forwarder — same lazy forwarder as nativeTicketDataSource; a shared table-driven forwarder would replace both.
const lazy = <M extends Record<string, any>, K extends keyof M & string>(load: () => Promise<M>, key: K): M[K] =>
  (async (...args: unknown[]) => (await load())[key](...args)) as unknown as M[K];

const projectActions = () => import('../actions/projectActions');
const taskActions = () => import('../actions/projectTaskActions');

export const nativeProjectDataSource: ProjectDataSource = Object.freeze({
  kind: 'native',
  screen: NATIVE_PROJECT_SCREEN,
  project: Object.freeze({
    metadata: lazy(projectActions, 'getProjectMetadata'),
    update: lazy(projectActions, 'updateProject'),
  }),
  tasks: Object.freeze({
    data: lazy(taskActions, 'getProjectTaskData'),
    forPhase: lazy(taskActions, 'getTasksForPhase'),
    get: lazy(taskActions, 'getTaskById'),
    commentCounts: lazy(() => import('../actions/projectTaskCommentActions'), 'getTaskCommentCountsBatch'),
    updateStatus: lazy(taskActions, 'updateTaskStatus'),
    reorder: lazy(taskActions, 'reorderTask'),
    reorderInStatus: lazy(taskActions, 'reorderTasksInStatus'),
    moveToPhase: lazy(taskActions, 'moveTaskToPhase'),
    update: lazy(taskActions, 'updateTaskWithChecklist'),
  }),
  options: Object.freeze({
    taskStatuses: lazy(projectActions, 'getProjectTaskStatuses'),
    statusesByPhase: lazy(projectActions, 'getProjectStatusesByPhase'),
    types: lazy(taskActions, 'getTaskTypes'),
    tree: lazy(projectActions, 'getProjectTreeData'),
  }),
  phases: Object.freeze({
    customStatusCounts: lazy(() => import('../actions/projectTaskStatusActions'), 'getPhaseCustomStatusCounts'),
    reorder: lazy(projectActions, 'reorderPhase'),
    update: lazy(projectActions, 'updatePhase'),
  }),
  /** Native TaskForm submits inline; this forwarder exists so the surface matches and is the plain task update. */
  editTask: async (request) => {
    const result = await (await taskActions()).updateTaskWithChecklist(request.taskId, request.changes as never);
    if (result && typeof result === 'object' && ('actionError' in result || 'permissionError' in result)) {
      return { ok: false, code: 'failed', message: (result as { actionError?: string; permissionError?: string }).actionError ?? (result as { permissionError?: string }).permissionError };
    }
    return { ok: true, task: result as never };
  },
} as ProjectDataSource);
