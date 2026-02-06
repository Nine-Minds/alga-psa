/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskTicketLinks from '../TaskTicketLinks';
import { TicketIntegrationProvider, type TicketIntegrationContextType } from '../../context/TicketIntegrationContext';

function createMockTicketIntegration(
  overrides: Partial<TicketIntegrationContextType> = {}
): TicketIntegrationContextType {
  return {
    getTicketsForList: vi.fn().mockResolvedValue([]),
    getConsolidatedTicketData: vi.fn().mockResolvedValue({}),
    getTicketCategories: vi.fn().mockResolvedValue([]),
    getAllBoards: vi.fn().mockResolvedValue([]),
    openTicketInDrawer: vi.fn().mockResolvedValue(undefined),
    renderQuickAddTicket: vi.fn().mockReturnValue(null),
    renderCategoryPicker: vi.fn().mockReturnValue(null),
    renderPrioritySelect: vi.fn().mockReturnValue(null),
    deleteTicket: vi.fn(),
    ...overrides,
  };
}

const getProjectMock = vi.fn();

vi.mock('../actions/projectActions', () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args)
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn() })
}));

describe('TaskTicketLinks prefill', () => {
  let mockCtx: TicketIntegrationContextType;

  beforeEach(() => {
    mockCtx = createMockTicketIntegration();
    getProjectMock.mockResolvedValue({
      client_id: 'client-1',
      client_name: 'Acme'
    });
  });

  it('accepts taskData prop without error', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks
          phaseId="phase-1"
          projectId="project-1"
          users={[]}
          taskData={{
            task_name: 'Task A',
            description: 'Desc',
            assigned_to: 'user-1',
            due_date: new Date('2026-02-05T00:00:00.000Z'),
          }}
        />
      </TicketIntegrationProvider>
    );

    expect(screen.getByRole('button', { name: 'Create Ticket' })).toBeInTheDocument();
  });

  it('fetches project client before opening QuickAddTicket', async () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks
          phaseId="phase-1"
          projectId="project-1"
          users={[]}
          taskData={{
            task_name: 'Task A',
            description: 'Desc',
            assigned_to: 'user-1',
            due_date: new Date('2026-02-05T00:00:00.000Z'),
          }}
        />
      </TicketIntegrationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));
    expect(getProjectMock).toHaveBeenCalledWith('project-1');
  });

  it('passes task prefill data to renderQuickAddTicket', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks
          phaseId="phase-1"
          projectId="project-1"
          users={[]}
          taskData={{
            task_name: 'Task A',
            description: 'Desc',
            assigned_to: 'user-1',
            due_date: new Date('2026-02-05T00:00:00.000Z'),
          }}
        />
      </TicketIntegrationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(mockCtx.renderQuickAddTicket).toHaveBeenCalled();
    const renderProps = (mockCtx.renderQuickAddTicket as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(renderProps.prefilledTitle).toBe('Task A');
    expect(renderProps.prefilledDescription).toBe('Desc');
    expect(renderProps.prefilledAssignedTo).toBe('user-1');
    expect(renderProps.prefilledDueDate).toEqual(new Date('2026-02-05T00:00:00.000Z'));
  });

  it('passes project client as prefilledClient', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks
          phaseId="phase-1"
          projectId="project-1"
          users={[]}
          taskData={{
            task_name: 'Task A',
            description: 'Desc',
            assigned_to: 'user-1',
            due_date: new Date('2026-02-05T00:00:00.000Z'),
          }}
        />
      </TicketIntegrationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(mockCtx.renderQuickAddTicket).toHaveBeenCalled();
    const renderProps = (mockCtx.renderQuickAddTicket as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(renderProps.prefilledClient).toEqual({ id: 'client-1', name: 'Acme' });
  });

  it('E2E: create ticket from task prefills key fields', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks
          phaseId="phase-1"
          projectId="project-1"
          users={[]}
          taskData={{
            task_name: 'Task A',
            description: 'Desc',
            assigned_to: 'user-1',
            due_date: new Date('2026-02-05T00:00:00.000Z'),
          }}
        />
      </TicketIntegrationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(mockCtx.renderQuickAddTicket).toHaveBeenCalled();
    const renderProps = (mockCtx.renderQuickAddTicket as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(renderProps.prefilledTitle).toBe('Task A');
    expect(renderProps.prefilledDescription).toBe('Desc');
    expect(renderProps.prefilledClient).toEqual({ id: 'client-1', name: 'Acme' });
  });

  it('does not prefill priority in renderQuickAddTicket props', () => {
    render(
      <TicketIntegrationProvider value={mockCtx}>
        <TaskTicketLinks
          phaseId="phase-1"
          projectId="project-1"
          users={[]}
          taskData={{
            task_name: 'Task A',
            description: 'Desc',
            assigned_to: 'user-1',
            due_date: new Date('2026-02-05T00:00:00.000Z'),
          }}
        />
      </TicketIntegrationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Ticket' }));

    expect(mockCtx.renderQuickAddTicket).toHaveBeenCalled();
    const renderProps = (mockCtx.renderQuickAddTicket as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(renderProps.prefilledPriority).toBeUndefined();
  });
});
