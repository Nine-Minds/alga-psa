/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskTicketLinks from '../TaskTicketLinks';

const getProjectMock = vi.fn();
let lastQuickAddProps: any = null;

vi.mock('@alga-psa/tickets/components/QuickAddTicket', () => ({
  QuickAddTicket: (props: any) => {
    lastQuickAddProps = props;
    return <div data-testid="quick-add-ticket" />;
  }
}));

vi.mock('../actions/projectActions', () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args)
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn() })
}));

describe('TaskTicketLinks prefill', () => {
  beforeEach(() => {
    lastQuickAddProps = null;
    getProjectMock.mockResolvedValue({
      client_id: 'client-1',
      client_name: 'Acme'
    });
  });

  it('accepts taskData prop without error', () => {
    render(
      <TaskTicketLinks
        phaseId="phase-1"
        projectId="project-1"
        users={[]}
        taskData={{
          task_name: 'Task A',
          description: 'Desc',
          assigned_to: 'user-1',
          due_date: new Date('2026-02-05T00:00:00.000Z'),
          estimated_hours: 120
        }}
      />
    );

    expect(screen.getByRole('button', { name: 'Create Ticket' })).toBeInTheDocument();
  });

  it('fetches project client before opening QuickAddTicket', async () => {
    render(
      <TaskTicketLinks
        phaseId="phase-1"
        projectId="project-1"
        users={[]}
        taskData={{
          task_name: 'Task A',
          description: 'Desc',
          assigned_to: 'user-1',
          due_date: new Date('2026-02-05T00:00:00.000Z'),
          estimated_hours: 120
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));
    expect(getProjectMock).toHaveBeenCalledWith('project-1');
  });

  it('passes task prefill data to QuickAddTicket', () => {
    render(
      <TaskTicketLinks
        phaseId="phase-1"
        projectId="project-1"
        users={[]}
        taskData={{
          task_name: 'Task A',
          description: 'Desc',
          assigned_to: 'user-1',
          due_date: new Date('2026-02-05T00:00:00.000Z'),
          estimated_hours: 120
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(lastQuickAddProps.prefilledTitle).toBe('Task A');
    expect(lastQuickAddProps.prefilledDescription).toBe('Desc');
    expect(lastQuickAddProps.prefilledAssignedTo).toBe('user-1');
    expect(lastQuickAddProps.prefilledDueDate).toEqual(new Date('2026-02-05T00:00:00.000Z'));
    expect(lastQuickAddProps.prefilledEstimatedHours).toBe(2);
  });

  it('passes project client as prefilledClient', () => {
    render(
      <TaskTicketLinks
        phaseId="phase-1"
        projectId="project-1"
        users={[]}
        taskData={{
          task_name: 'Task A',
          description: 'Desc',
          assigned_to: 'user-1',
          due_date: new Date('2026-02-05T00:00:00.000Z'),
          estimated_hours: 120
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(lastQuickAddProps.prefilledClient).toEqual({ id: 'client-1', name: 'Acme' });
  });
});
