/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
      String(fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? '')),
  }),
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: (props: any) =>
    props.isOpen ? (
      <div role="dialog">
        <h2>{props.title}</h2>
        <div>{props.message}</div>
        <button onClick={props.onConfirm}>{props.confirmLabel}</button>
        <button onClick={props.onClose}>{props.cancelLabel}</button>
      </div>
    ) : null,
}));

import { useDependencyGuard } from '../useDependencyGuard';

afterEach(cleanup);

const day = (iso: string) => new Date(`${iso}T00:00:00`);
const statuses = [
  { project_status_mapping_id: 'todo', name: 'To do', custom_name: null, display_order: 1, is_closed: false },
  { project_status_mapping_id: 'doing', name: 'In progress', custom_name: null, display_order: 2, is_closed: false },
] as ProjectStatus[];
const task = (id: string, overrides: Partial<IProjectTask> = {}) =>
  ({ tenant: 't', task_id: id, phase_id: 'p', task_name: `Task ${id}`, project_status_mapping_id: 'todo', wbs_code: id, start_date: null, due_date: null, estimated_hours: 0, ...overrides }) as IProjectTask;
const input = {
  tasks: [task('a', { start_date: day('2026-10-05'), due_date: day('2026-10-09') }), task('b', { start_date: day('2026-10-12'), due_date: day('2026-10-14') })],
  phases: [{ phase_id: 'p', start_date: null, end_date: null }] as unknown as IProjectPhase[],
  taskDependencies: {
    b: { predecessors: [{ dependency_id: 'd', predecessor_task_id: 'a', successor_task_id: 'b', dependency_type: 'blocks', lead_lag_days: 0 } as any], successors: [] },
  },
  statuses,
};

function Harness({ onReady }: { onReady: (confirm: ReturnType<typeof useDependencyGuard>['confirmTaskChanges']) => void }) {
  const { confirmTaskChanges, dependencyGuardDialog } = useDependencyGuard(input);
  onReady(confirmTaskChanges);
  return <>{dependencyGuardDialog}</>;
}

describe('useDependencyGuard', () => {
  it('resolves true without a dialog when nothing is contradicted', async () => {
    let confirm!: ReturnType<typeof useDependencyGuard>['confirmTaskChanges'];
    render(<Harness onReady={(fn) => (confirm = fn)} />);
    await expect(confirm([{ taskId: 'a', change: { project_status_mapping_id: 'doing' } }])).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before starting a blocked task and honours both answers', async () => {
    let confirm!: ReturnType<typeof useDependencyGuard>['confirmTaskChanges'];
    render(<Harness onReady={(fn) => (confirm = fn)} />);

    let answer: Promise<boolean>;
    act(() => {
      answer = confirm([{ taskId: 'b', change: { project_status_mapping_id: 'doing' } }]);
    });
    expect(screen.queryByText('This task is blocked')).not.toBeNull();
    expect(screen.queryByText('"Task b" is still waiting on: Task a.')).not.toBeNull();
    fireEvent.click(screen.getByText('Cancel'));
    await expect(answer!).resolves.toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      answer = confirm([{ taskId: 'b', change: { start_date: day('2026-10-07'), due_date: day('2026-10-08') } }]);
    });
    expect(screen.queryByText('Dependency conflict')).not.toBeNull();
    fireEvent.click(screen.getByText('Continue anyway'));
    await expect(answer!).resolves.toBe(true);
  });
});
