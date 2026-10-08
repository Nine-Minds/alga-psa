'use client';

import { useMemo, useRef } from 'react';

export interface UrlTaskOpenGuard {
  /**
   * Call when the task id in the URL changes. Returns true when that task
   * still has to be opened; false when the URL carries no task or the task is
   * the one already handled.
   */
  arm: (urlTaskId: string | null | undefined) => boolean;
  /** Whether the armed task is still waiting to be opened. */
  canOpen: () => boolean;
  /** Record that a task's dialog is open, whether from the URL or from a click. */
  markOpened: (taskId: string) => void;
}

/**
 * Opens a task named in the URL exactly once.
 *
 * Clicking a task also writes its id to the URL. Without remembering that the
 * clicked task is already handled, the open-from-URL logic re-armed for it and
 * reopened the dialog the next time the task list refreshed — after a save,
 * whenever the task was not on the current kanban board (timeline, list).
 */
export function useUrlTaskOpenGuard(): UrlTaskOpenGuard {
  const handledTaskId = useRef<string | null>(null);
  const opened = useRef(false);

  return useMemo<UrlTaskOpenGuard>(
    () => ({
      arm(urlTaskId) {
        if (!urlTaskId) {
          // The dialog closed; a later link to the same task should open it again.
          handledTaskId.current = null;
          return false;
        }
        if (handledTaskId.current === urlTaskId) return false;
        opened.current = false;
        return true;
      },
      canOpen() {
        return !opened.current;
      },
      markOpened(taskId) {
        opened.current = true;
        handledTaskId.current = taskId;
      },
    }),
    [],
  );
}
