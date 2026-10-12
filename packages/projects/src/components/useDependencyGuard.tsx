'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from 'react-i18next';
import { dependencyWarnings, type DependencyWarning, type TaskChange } from '../lib/dependencyGuards';
import { collectGanttEdges, type TaskDependencyMap } from '../lib/ganttSchedule';

/** Warnings listed before the rest are summarised as a count. */
const MAX_LISTED = 5;

interface DependencyGuardInput {
  tasks: IProjectTask[];
  phases: IProjectPhase[];
  taskDependencies: TaskDependencyMap;
  statuses: ProjectStatus[];
  statusesByPhase?: Record<string, ProjectStatus[]>;
}

/**
 * Dependencies are advisory: nothing stops a blocked task from starting. This
 * asks the user to confirm before a status or date change that would
 * contradict one, and resolves true when there is nothing to confirm.
 */
export function useDependencyGuard(input: DependencyGuardInput): {
  confirmTaskChanges: (changes: Array<{ taskId: string; change: TaskChange }>) => Promise<boolean>;
  dependencyGuardDialog: React.ReactNode;
} {
  const { t } = useTranslation('features/projects');
  // Callers are long-lived callbacks; read the latest data without re-creating them.
  const inputRef = useRef(input);
  inputRef.current = input;

  const [pending, setPending] = useState<{ warnings: DependencyWarning[]; resolve: (proceed: boolean) => void } | null>(null);

  const confirmTaskChanges = useCallback((changes: Array<{ taskId: string; change: TaskChange }>) => {
    const { tasks, phases, taskDependencies, statuses, statusesByPhase } = inputRef.current;
    const allStatuses = new Map<string, ProjectStatus>();
    for (const status of statuses) allStatuses.set(status.project_status_mapping_id, status);
    for (const phaseStatuses of Object.values(statusesByPhase ?? {})) {
      for (const status of phaseStatuses) allStatuses.set(status.project_status_mapping_id, status);
    }
    const warnings = dependencyWarnings(
      { tasks, phases, edges: collectGanttEdges(taskDependencies), statuses: [...allStatuses.values()] },
      changes,
    );
    if (warnings.length === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPending({ warnings, resolve }));
  }, []);

  const settle = useCallback(
    (proceed: boolean) => {
      pending?.resolve(proceed);
      setPending(null);
    },
    [pending],
  );

  const describe = useCallback(
    (warning: DependencyWarning): string => {
      switch (warning.kind) {
        case 'blocked-status':
          return t('dependencyGuard.blockedStatus', '"{{task}}" is still waiting on: {{blockers}}.', {
            task: warning.taskName,
            blockers: warning.blockerNames.join(', '),
          });
        case 'starts-before-blocker':
          return t('dependencyGuard.startsBeforeBlocker', '"{{task}}" would start before "{{other}}" is due to finish.', {
            task: warning.taskName,
            other: warning.otherTaskName,
          });
        case 'ends-after-dependent':
          return t('dependencyGuard.endsAfterDependent', '"{{task}}" would finish after "{{other}}" is due to start.', {
            task: warning.taskName,
            other: warning.otherTaskName,
          });
      }
    },
    [t],
  );

  const dependencyGuardDialog = useMemo(() => {
    if (!pending) return null;
    const listed = pending.warnings.slice(0, MAX_LISTED);
    const more = pending.warnings.length - listed.length;
    const onlyStatus = pending.warnings.every((warning) => warning.kind === 'blocked-status');
    return (
      <ConfirmationDialog
        id="dependency-guard-dialog"
        isOpen
        onClose={() => settle(false)}
        onConfirm={() => settle(true)}
        title={
          onlyStatus
            ? t('dependencyGuard.blockedTitle', 'This task is blocked')
            : t('dependencyGuard.conflictTitle', 'Dependency conflict')
        }
        message={
          <div className="space-y-2">
            <ul className="list-disc space-y-1 pl-5">
              {listed.map((warning, index) => (
                <li key={index}>{describe(warning)}</li>
              ))}
            </ul>
            {more > 0 && <p>{t('dependencyGuard.more', 'And {{remaining}} more.', { remaining: more })}</p>}
            <p>{t('dependencyGuard.question', 'Dependencies are not enforced, so you can continue. Do you want to?')}</p>
          </div>
        }
        confirmLabel={t('dependencyGuard.proceed', 'Continue anyway')}
        cancelLabel={t('dependencyGuard.cancel', 'Cancel')}
      />
    );
  }, [pending, settle, describe, t]);

  return { confirmTaskChanges, dependencyGuardDialog };
}
