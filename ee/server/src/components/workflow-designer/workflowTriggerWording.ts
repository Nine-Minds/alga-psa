import type { TFunction } from 'i18next';

export type WorkflowPauseWording = {
  pauseTitle: string;
  resumeTitle: string;
  pausedToast: string;
  resumedToast: string;
};

/**
 * What pausing stops depends on how the workflow starts: new events, the record dates it watches,
 * or the schedules of a workflow without a trigger.
 */
export const getWorkflowPauseWording = (
  trigger: 'manual' | 'event' | 'date',
  t: TFunction | ((key: string, options?: Record<string, unknown>) => string)
): WorkflowPauseWording => {
  if (trigger === 'date') {
    return {
      pauseTitle: t('designer.toolbar.pauseTitleDate', { defaultValue: 'Active: runs start on the dates this workflow watches. Click to pause.' }),
      resumeTitle: t('designer.toolbar.resumeTitleDate', { defaultValue: 'Paused: watched dates don’t start runs. Click to make it active.' }),
      pausedToast: t('designer.toolbar.pausedToastDate', { defaultValue: 'Workflow paused. Watched dates won’t start runs.' }),
      resumedToast: t('designer.toolbar.resumedToastDate', { defaultValue: 'Workflow active. Watched dates start runs again.' }),
    };
  }
  if (trigger === 'manual') {
    return {
      pauseTitle: t('designer.toolbar.pauseTitleManual', { defaultValue: 'Active: schedules can start runs. Click to pause.' }),
      resumeTitle: t('designer.toolbar.resumeTitleManual', { defaultValue: 'Paused: schedules don’t start runs. Click to make it active.' }),
      pausedToast: t('designer.toolbar.pausedToastManual', { defaultValue: 'Workflow paused. Schedules won’t start runs.' }),
      resumedToast: t('designer.toolbar.resumedToastManual', { defaultValue: 'Workflow active. Schedules start runs again.' }),
    };
  }
  return {
    pauseTitle: t('designer.toolbar.pauseTitle', { defaultValue: 'Active: new events start runs. Click to pause.' }),
    resumeTitle: t('designer.toolbar.resumeTitle', { defaultValue: 'Paused: new events don’t start runs. Click to make it active.' }),
    pausedToast: t('designer.toolbar.pausedToast', { defaultValue: 'Workflow paused. New events won’t start runs.' }),
    resumedToast: t('designer.toolbar.resumedToast', { defaultValue: 'Workflow active. New events start runs again.' }),
  };
};
