'use client';

import React from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Flex, Heading, Text } from '@radix-ui/themes';
import { useOptionalActivityCrossFeature } from '@alga-psa/ui/context';
import type { SchedulingProjectTaskDetailsRecord } from '../../actions/projectTaskLookupActions';

interface SchedulingProjectTaskDetailsProps {
  task: SchedulingProjectTaskDetailsRecord;
}

export function SchedulingProjectTaskDetails({
  task,
}: SchedulingProjectTaskDetailsProps): React.JSX.Element {
  const { t } = useTranslation('msp/schedule');
  const { formatDate } = useFormatters();

  function formatDateTime(value: Date | string | null | undefined): string {
    if (!value) return t('projectTaskDetails.notAvailable');
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : formatDate(date, {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  }

  const activityCrossFeature = useOptionalActivityCrossFeature();
  return (
    <div className="h-full bg-white p-6 rounded-lg shadow-sm">
      <Flex direction="column" gap="4">
        <Heading size="6">{task.task_name || t('projectTaskDetails.title')}</Heading>

        {activityCrossFeature?.renderActivityGroupControl
          ? activityCrossFeature.renderActivityGroupControl({
              id: 'scheduling-project-task-activity-group',
              activityType: 'projectTask',
              activityId: task.task_id,
              // Only the primary assignee is loaded here; the control re-checks eligibility on mount.
              assignmentKey: task.assigned_to ?? '',
            })
          : null}

        <div>
          <Text size="2" weight="bold">{t('projectTaskDetails.fields.description.label')}</Text>
          <Text size="2" className="block mt-1 whitespace-pre-wrap">
            {task.task_description || t('projectTaskDetails.noDescription')}
          </Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('projectTaskDetails.fields.project.label')}</Text>
          <Text size="2" className="block mt-1">{task.project_name || t('projectTaskDetails.notAvailable')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('projectTaskDetails.fields.phase.label')}</Text>
          <Text size="2" className="block mt-1">{task.phase_name || t('projectTaskDetails.notAvailable')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('projectTaskDetails.fields.assignedTo.label')}</Text>
          <Text size="2" className="block mt-1">{task.assigned_to_name || t('projectTaskDetails.unassigned')}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('projectTaskDetails.fields.dueDate.label')}</Text>
          <Text size="2" className="block mt-1">{formatDateTime(task.due_date)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">{t('projectTaskDetails.fields.checklist.label')}</Text>
          {task.checklist_items.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
              {task.checklist_items.map((item) => (
                <li key={item.checklist_item_id}>
                  {item.completed ? '[x] ' : '[ ] '}
                  {item.item_name || t('projectTaskDetails.untitledItem')}
                </li>
              ))}
            </ul>
          ) : (
            <Text size="2" className="block mt-1">{t('projectTaskDetails.noChecklistItems')}</Text>
          )}
        </div>
      </Flex>
    </div>
  );
}
