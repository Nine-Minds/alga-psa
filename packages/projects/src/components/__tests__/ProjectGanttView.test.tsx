/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(async () => new Map()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? '')),
  }),
}));

import ProjectGanttView from '../ProjectGanttView';

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom has no PointerEvent, so pointer events would arrive without coordinates.
  (globalThis as any).PointerEvent = class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  };
  // jsdom has no pointer capture.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
});

afterEach(cleanup);

const NOW = new Date();

const phase = (id: string, order: number, overrides: Partial<IProjectPhase> = {}) =>
  ({
    tenant: 't',
    phase_id: id,
    project_id: 'p',
    phase_name: `Phase ${id}`,
    description: null,
    start_date: null,
    end_date: null,
    status: 'active',
    order_number: order,
    wbs_code: String(order),
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }) as IProjectPhase;

const task = (id: string, phaseId: string, overrides: Partial<IProjectTask> = {}) =>
  ({
    tenant: 't',
    task_id: id,
    phase_id: phaseId,
    task_name: `Task ${id}`,
    description: null,
    assigned_to: null,
    estimated_hours: 0,
    actual_hours: 0,
    project_status_mapping_id: 'open',
    wbs_code: `1.${id}`,
    start_date: null,
    due_date: null,
    task_type_key: 'task',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }) as IProjectTask;

const statuses = [
  { project_status_mapping_id: 'open', name: 'Open', is_closed: false, color: '#00f' },
  { project_status_mapping_id: 'done', name: 'Done', is_closed: true, color: '#0f0' },
] as unknown as ProjectStatus[];

const baseProps = {
  phases: [phase('a', 1), phase('b', 2)],
  tasks: [task('1', 'a'), task('2', 'a', { project_status_mapping_id: 'done' }), task('3', 'b')],
  statuses,
  taskDependencies: {},
};

describe('ProjectGanttView', () => {
  it('renders a row and a bar per task under its phase', () => {
    render(<ProjectGanttView {...baseProps} />);
    expect(screen.queryByText('Phase a')).not.toBeNull();
    expect(screen.queryByText('Task 1')).not.toBeNull();
    expect(document.getElementById('gantt-bar-1')).not.toBeNull();
    expect(document.getElementById('gantt-bar-3')).not.toBeNull();
    // 1 of 2 tasks in phase a is closed.
    expect(screen.queryByText('50%')).not.toBeNull();
    // A phase without dates says so instead of drawing a band.
    expect(screen.queryAllByText('No phase dates set').length).toBe(2);
  });

  it('draws a phase from its own dates, not from its tasks', () => {
    render(
      <ProjectGanttView
        {...baseProps}
        phases={[phase('a', 1, { start_date: new Date(2026, 9, 5), end_date: new Date(2026, 9, 16) }), phase('b', 2)]}
      />,
    );
    expect(screen.queryByText(/Oct 5 – Oct 16 · 50% complete/)).not.toBeNull();
  });

  it('opens the task when its bar is clicked', () => {
    const onTaskClick = vi.fn();
    render(<ProjectGanttView {...baseProps} onTaskClick={onTaskClick} />);
    fireEvent.click(document.getElementById('gantt-bar-1')!);
    expect(onTaskClick).toHaveBeenCalledWith(expect.objectContaining({ task_id: '1' }));
  });

  it('collapses a phase', () => {
    render(<ProjectGanttView {...baseProps} />);
    fireEvent.click(document.getElementById('gantt-phase-toggle-a')!);
    expect(screen.queryByText('Task 1')).toBeNull();
    expect(screen.queryByText('Task 3')).not.toBeNull();
  });

  it('hides completed tasks when the setting is on', () => {
    render(<ProjectGanttView {...baseProps} settings={{ hideClosed: true }} onSettingsChange={vi.fn()} />);
    expect(screen.queryByText('Task 2')).toBeNull();
    expect(screen.queryByText('Task 1')).not.toBeNull();
  });

  it('shows only tasks left by the project filters and says so when none match', () => {
    const { rerender } = render(
      <ProjectGanttView {...baseProps} visibleTaskIds={new Set(['3'])} hasActiveFilters />,
    );
    expect(screen.queryByText('Task 1')).toBeNull();
    expect(screen.queryByText('Task 3')).not.toBeNull();

    rerender(<ProjectGanttView {...baseProps} visibleTaskIds={new Set()} hasActiveFilters />);
    expect(screen.queryByText('No tasks match the current filters.')).not.toBeNull();
  });

  it('offers to add a phase when the project has none', () => {
    const onAddPhase = vi.fn();
    render(<ProjectGanttView {...baseProps} phases={[]} tasks={[]} onAddPhase={onAddPhase} />);
    fireEvent.click(screen.getByText('Add phase'));
    expect(onAddPhase).toHaveBeenCalled();
  });

  it('saves both dates when a bar is dragged, without opening the task', async () => {
    const onTaskDatesChange = vi.fn();
    const onTaskClick = vi.fn();
    const start = new Date(2026, 9, 6);
    const due = new Date(2026, 9, 8);
    render(
      <ProjectGanttView
        {...baseProps}
        tasks={[task('1', 'a', { start_date: start, due_date: due })]}
        canEdit
        onTaskDatesChange={onTaskDatesChange}
        onTaskClick={onTaskClick}
      />,
    );
    const bar = document.getElementById('gantt-bar-1')!;
    // Week scale is 11px per day, so 22px is two days.
    fireEvent.pointerDown(bar, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 122, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 122, pointerId: 1 });
    fireEvent.click(bar);

    expect(onTaskDatesChange).toHaveBeenCalledWith('1', {
      start_date: new Date(2026, 9, 8),
      due_date: new Date(2026, 9, 10),
    });
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it('moves a focused bar a day with Alt + arrow', () => {
    const onTaskDatesChange = vi.fn();
    render(
      <ProjectGanttView
        {...baseProps}
        tasks={[task('1', 'a', { start_date: new Date(2026, 9, 6), due_date: new Date(2026, 9, 8) })]}
        canEdit
        onTaskDatesChange={onTaskDatesChange}
      />,
    );
    fireEvent.keyDown(document.getElementById('gantt-bar-1')!, { key: 'ArrowRight', altKey: true });
    expect(onTaskDatesChange).toHaveBeenCalledWith('1', {
      start_date: new Date(2026, 9, 7),
      due_date: new Date(2026, 9, 9),
    });
  });

  it('does not let a read-only user drag', () => {
    const onTaskDatesChange = vi.fn();
    render(
      <ProjectGanttView
        {...baseProps}
        tasks={[task('1', 'a', { start_date: new Date(2026, 9, 6), due_date: new Date(2026, 9, 8) })]}
        onTaskDatesChange={onTaskDatesChange}
      />,
    );
    const bar = document.getElementById('gantt-bar-1')!;
    fireEvent.pointerDown(bar, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 150, pointerId: 1 });
    expect(onTaskDatesChange).not.toHaveBeenCalled();
  });

  it('explains a clicked arrow and lets an editor remove the dependency', () => {
    const onRemoveDependency = vi.fn();
    const dependency = { dependency_id: 'dep1', predecessor_task_id: '1', successor_task_id: '2', dependency_type: 'blocks', lead_lag_days: 0 };
    const props = {
      ...baseProps,
      taskDependencies: { '2': { predecessors: [dependency], successors: [] } } as any,
      onRemoveDependency,
    };
    const { rerender } = render(<ProjectGanttView {...props} />);
    fireEvent.click(document.getElementById('gantt-edge-dep1')!);
    expect(screen.queryByText('"Task 1" must finish before "Task 2" can start.')).not.toBeNull();
    // Read-only users can inspect a dependency but not remove it.
    expect(document.getElementById('gantt-remove-dependency')).toBeNull();

    rerender(<ProjectGanttView {...props} canEdit />);
    fireEvent.click(document.getElementById('gantt-remove-dependency')!);
    expect(onRemoveDependency).toHaveBeenCalledWith('dep1');
  });

  it('fades everything outside the hovered task\'s dependency chain', () => {
    const dependency = { dependency_id: 'dep1', predecessor_task_id: '1', successor_task_id: '2', dependency_type: 'blocks', lead_lag_days: 0 };
    const { container } = render(
      <ProjectGanttView {...baseProps} taskDependencies={{ '2': { predecessors: [dependency], successors: [] } } as any} />,
    );
    const styles = () => [...container.querySelectorAll('style')].map((style) => style.textContent).join('');
    vi.useFakeTimers();
    try {
      // The row highlights at once; the fade waits for the pointer to rest.
      fireEvent.mouseEnter(container.querySelector('[data-gantt-task-id="1"]')!);
      expect(styles()).toContain('[data-gantt-row="1"]');
      expect(styles()).not.toContain('opacity:0.35');
      vi.advanceTimersByTime(400);
      expect(styles()).toContain('[data-edge-id="dep1"]');
      expect(styles()).toContain('[data-gantt-bar="2"]');

      // Crossing to a neighbouring row keeps the fade instead of flashing it off and on.
      fireEvent.mouseLeave(container.querySelector('[data-gantt-task-id="1"]')!);
      expect(styles()).toContain('opacity:0.35');
      fireEvent.mouseEnter(container.querySelector('[data-gantt-task-id="2"]')!);
      expect(styles()).toContain('opacity:0.35');

      // A task with no dependencies highlights itself without dimming the chart.
      fireEvent.mouseEnter(container.querySelector('[data-gantt-task-id="3"]')!);
      expect(styles()).not.toContain('opacity:0.35');

      // Leaving the chart clears everything after the short release.
      fireEvent.mouseEnter(container.querySelector('[data-gantt-task-id="1"]')!);
      vi.advanceTimersByTime(400);
      fireEvent.mouseLeave(container.querySelector('[data-gantt-task-id="1"]')!);
      vi.advanceTimersByTime(200);
      expect(styles()).not.toContain('opacity:0.35');
    } finally {
      vi.useRealTimers();
    }
  });

  it('only exposes the dependency handle to users who can edit', () => {
    const editing = { onTaskDatesChange: vi.fn(), onAddDependency: vi.fn() };
    const { container, rerender } = render(<ProjectGanttView {...baseProps} {...editing} />);
    expect(container.querySelector('.cursor-crosshair')).toBeNull();
    rerender(<ProjectGanttView {...baseProps} {...editing} canEdit />);
    expect(container.querySelector('.cursor-crosshair')).not.toBeNull();
  });
});
