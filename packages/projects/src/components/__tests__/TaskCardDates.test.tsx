/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { IProjectTask } from '@alga-psa/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key) }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  // Mark which format was asked for, so the test can tell a short start from a full due date.
  useFormatters: () => ({
    formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) =>
      `${options?.dateStyle ? 'full' : 'short'}:${date.toISOString().slice(0, 10)}`,
  }),
}));
vi.mock('@alga-psa/ui/hooks', () => ({
  useTruncationDetection: () => ({ ref: { current: null }, isTruncated: false }),
}));
vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/UserAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components', () => ({ TagList: () => null }));
vi.mock('@alga-psa/tags/components', () => ({ TagManager: () => null }));
vi.mock('@alga-psa/ui/components/Tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getUserAvatarUrlsBatchAction: vi.fn(async () => new Map()) }));
vi.mock('@alga-psa/teams/actions', () => ({ getTeamAvatarUrlsBatchAction: vi.fn(async () => new Map()) }));
vi.mock('../../lib/useTaskTypeLabel', () => ({ useTaskTypeLabel: () => () => 'Task' }));
vi.mock('../TaskSelectionContext', () => ({
  useTaskSelection: () => ({ isSelected: () => false, toggleTask: vi.fn(), setTasksSelected: vi.fn(), selectedTaskIds: new Set() }),
}));

import TaskCard from '../TaskCard';

afterEach(cleanup);

const noop = () => undefined;
function renderCard(dates: { start_date: Date | null; due_date: Date | null }, zoomLevel = 50) {
  const task = {
    tenant: 't',
    task_id: 'task-1',
    phase_id: 'p',
    task_name: 'Rack the switch',
    description: null,
    assigned_to: null,
    estimated_hours: 0,
    actual_hours: 0,
    project_status_mapping_id: 's',
    wbs_code: '1.1',
    task_type_key: 'task',
    created_at: new Date(),
    updated_at: new Date(),
    ...dates,
  } as IProjectTask;
  return render(
    <TaskCard
      task={task}
      users={[]}
      zoomLevel={zoomLevel}
      onTaskSelected={noop}
      onAssigneeChange={noop}
      onDragStart={noop}
      onDragEnd={noop}
      onMoveTaskClick={noop}
      onDuplicateTaskClick={noop}
      onEditTaskClick={noop}
      onDeleteTaskClick={noop}
    />,
  ).container.textContent ?? '';
}

const START = new Date('2026-10-05T00:00:00.000Z');
const DUE = new Date('2026-10-09T00:00:00.000Z');

describe('TaskCard dates', () => {
  it('shows a range, without the "Due" label, when the task has both dates', () => {
    const text = renderCard({ start_date: START, due_date: DUE });
    expect(text).toContain('short:2026-10-05 – full:2026-10-09');
    // "Due: Oct 5 – Oct 9" would mislabel the start.
    expect(text).not.toContain('Due');
  });

  it('keeps the existing "Due" label for a task with only a due date', () => {
    const text = renderCard({ start_date: null, due_date: DUE });
    expect(text).toContain('Due: full:2026-10-09');
    expect(text).not.toContain('–');
  });

  it('labels a lone start date', () => {
    const text = renderCard({ start_date: START, due_date: null });
    expect(text).toContain('Starts: full:2026-10-05');
    expect(text).not.toContain('No due date');
  });

  it('says there is no due date when the task has neither', () => {
    expect(renderCard({ start_date: null, due_date: null })).toContain('No due date');
  });

  it('drops the labels but keeps the dates on a compact card', () => {
    expect(renderCard({ start_date: null, due_date: DUE }, 20)).not.toContain('Due:');
    expect(renderCard({ start_date: null, due_date: DUE }, 20)).toContain('full:2026-10-09');
    cleanup();
    expect(renderCard({ start_date: START, due_date: null }, 20)).not.toContain('Starts:');
  });
});
