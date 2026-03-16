'use client';

import React from 'react';
import { Flex, Heading, Text } from '@radix-ui/themes';
import type { SchedulingProjectTaskDetailsRecord } from '../../actions/projectTaskLookupActions';

interface SchedulingProjectTaskDetailsProps {
  task: SchedulingProjectTaskDetailsRecord;
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function SchedulingProjectTaskDetails({
  task,
}: SchedulingProjectTaskDetailsProps): React.JSX.Element {
  return (
    <div className="h-full bg-white p-6 rounded-lg shadow-sm">
      <Flex direction="column" gap="4">
        <Heading size="6">{task.task_name || 'Project Task'}</Heading>

        <div>
          <Text size="2" weight="bold">Description</Text>
          <Text size="2" className="block mt-1 whitespace-pre-wrap">
            {task.task_description || 'No description'}
          </Text>
        </div>

        <div>
          <Text size="2" weight="bold">Project</Text>
          <Text size="2" className="block mt-1">{task.project_name || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Phase</Text>
          <Text size="2" className="block mt-1">{task.phase_name || 'N/A'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Assigned To</Text>
          <Text size="2" className="block mt-1">{task.assigned_to_name || 'Unassigned'}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Due Date</Text>
          <Text size="2" className="block mt-1">{formatDateTime(task.due_date)}</Text>
        </div>

        <div>
          <Text size="2" weight="bold">Checklist</Text>
          {task.checklist_items.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
              {task.checklist_items.map((item) => (
                <li key={item.checklist_item_id}>
                  {item.completed ? '[x] ' : '[ ] '}
                  {item.item_name || 'Untitled item'}
                </li>
              ))}
            </ul>
          ) : (
            <Text size="2" className="block mt-1">No checklist items</Text>
          )}
        </div>
      </Flex>
    </div>
  );
}
