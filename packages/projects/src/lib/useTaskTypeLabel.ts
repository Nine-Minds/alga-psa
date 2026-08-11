'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Task type names are reference data, not UI copy: `standard_task_types` ships
 * six rows whose `type_name` is English in every tenant, and the Kanban card
 * rendered that column straight into a tooltip. So the badge read "Task" in a
 * French board even though the component's own fallback string was translated —
 * the fallback never ran, because the DB always had a value.
 *
 * Tenants can also define their own types in `custom_task_types`, which
 * override a standard key. Those names are the tenant's own words and must be
 * left alone, so a row is only translated when its name still matches the
 * shipped English one.
 */
const STANDARD_TASK_TYPE_NAMES: Record<string, string> = {
  task: 'Task',
  bug: 'Bug',
  feature: 'Feature',
  improvement: 'Improvement',
  epic: 'Epic',
  story: 'Story',
};

export type TaskTypeLike = {
  type_key?: string | null;
  type_name?: string | null;
} | null | undefined;

export function useTaskTypeLabel() {
  const { t } = useTranslation('features/projects');

  return useCallback(
    (taskType: TaskTypeLike, fallbackKey?: string | null): string => {
      const key = taskType?.type_key ?? fallbackKey ?? undefined;
      const name = taskType?.type_name ?? undefined;

      if (key && name && STANDARD_TASK_TYPE_NAMES[key] === name) {
        return t(`taskTypes.${key}`, name);
      }

      if (name) return name;
      if (key) return t(`taskTypes.${key}`, key);

      return t('projectDetail.taskTypeFallback', 'Task');
    },
    [t]
  );
}
