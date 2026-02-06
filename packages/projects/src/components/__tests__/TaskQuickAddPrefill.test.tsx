/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskQuickAdd from '../TaskQuickAdd';
import type { IProjectPhase, ProjectStatus } from '@alga-psa/types';

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => (props: any) => (
    <div data-testid="task-form" data-prefill={JSON.stringify(props.prefillData)} />
  )
}));

describe('TaskQuickAdd prefillData', () => {
  it('passes prefillData to TaskForm', () => {
    const phase: IProjectPhase = {
      phase_id: 'phase-1',
      project_id: 'project-1',
      phase_name: 'Phase 1',
      description: null,
      start_date: null,
      end_date: null,
      status: 'open',
      order_number: 1,
      created_at: new Date(),
      updated_at: new Date(),
      wbs_code: '1',
      tenant: 'tenant-1'
    } as IProjectPhase;

    const statuses: ProjectStatus[] = [
      {
        project_status_mapping_id: 'status-1',
        name: 'Open',
        custom_name: null,
        is_closed: false,
        is_visible: true,
        is_standard: true,
        display_order: 1,
        project_id: 'project-1',
        status_id: 'status-1'
      } as ProjectStatus
    ];

    render(
      <TaskQuickAdd
        phase={phase}
        onClose={() => undefined}
        onTaskAdded={() => undefined}
        onTaskUpdated={async () => undefined}
        projectStatuses={statuses}
        onCancel={() => undefined}
        users={[]}
        prefillData={{
          task_name: 'Prefilled Task',
          description: 'Prefilled description',
          assigned_to: null,
          due_date: null,
          estimated_hours: 1
        }}
      />
    );

    expect(screen.getByTestId('task-form')).toHaveAttribute(
      'data-prefill',
      JSON.stringify({
        task_name: 'Prefilled Task',
        description: 'Prefilled description',
        assigned_to: null,
        due_date: null,
        estimated_hours: 1
      })
    );
  });
});
