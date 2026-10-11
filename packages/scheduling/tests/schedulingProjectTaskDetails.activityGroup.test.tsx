/**
 * @vitest-environment jsdom
 */
/**
 * The scheduling task detail hosts the personal "My group" control only through the
 * cross-feature context (no @alga-psa/user-activities dependency). Without a provider
 * (AlgaDesk, standalone) it must render normally and never throw.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityCrossFeatureProvider } from '@alga-psa/ui/context';
import { SchedulingProjectTaskDetails } from '../src/components/shared/SchedulingProjectTaskDetails';

const task = {
  task_id: 'task-1',
  task_name: 'Wire the thing',
  task_description: null,
  phase_id: null,
  phase_name: null,
  project_id: null,
  project_name: null,
  project_status_mapping_id: null,
  status_id: null,
  due_date: null,
  assigned_to: 'user-9',
  assigned_to_name: 'Una User',
  checklist_items: [],
} as any;

describe('SchedulingProjectTaskDetails "My group" host', () => {
  it('renders without any provider and without throwing', () => {
    render(<SchedulingProjectTaskDetails task={task} />);
    expect(screen.getByText('Wire the thing')).toBeTruthy();
    expect(screen.queryByTestId('group-control')).toBeNull();
  });

  it('renders without the control when the provider does not supply renderActivityGroupControl', () => {
    render(
      <ActivityCrossFeatureProvider value={{} as any}>
        <SchedulingProjectTaskDetails task={task} />
      </ActivityCrossFeatureProvider>
    );
    expect(screen.queryByTestId('group-control')).toBeNull();
  });

  it('passes projectTask + task_id + a saved-state assignmentKey to the provider callback', () => {
    const renderActivityGroupControl = vi.fn((p: any) => <span data-testid="group-control">{p.activityType}:{p.activityId}</span>);
    render(
      <ActivityCrossFeatureProvider value={{ renderActivityGroupControl } as any}>
        <SchedulingProjectTaskDetails task={task} />
      </ActivityCrossFeatureProvider>
    );
    expect(screen.getByTestId('group-control').textContent).toBe('projectTask:task-1');
    expect(renderActivityGroupControl).toHaveBeenCalledWith(
      expect.objectContaining({ activityType: 'projectTask', activityId: 'task-1', assignmentKey: 'user-9' })
    );
  });
});
