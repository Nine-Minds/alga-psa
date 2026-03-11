import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();
const ticketGetByIdMock = vi.fn();
const projectTasksGetMock = vi.fn();
const contactGetByIdMock = vi.fn();
const timeEntryGetByIdMock = vi.fn();
const timeSheetGetByIdMock = vi.fn();

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('server/src/lib/api/services/TicketService', () => ({
  TicketService: class {
    getById(...args: unknown[]) {
      return ticketGetByIdMock(...args);
    }
  },
}));

vi.mock('server/src/lib/api/services/ProjectService', () => ({
  ProjectService: class {
    getTasks(...args: unknown[]) {
      return projectTasksGetMock(...args);
    }
  },
}));

vi.mock('server/src/lib/api/services/ContactService', () => ({
  ContactService: class {
    getById(...args: unknown[]) {
      return contactGetByIdMock(...args);
    }
  },
}));

vi.mock('server/src/lib/api/services/TimeEntryService', () => ({
  TimeEntryService: class {
    getById(...args: unknown[]) {
      return timeEntryGetByIdMock(...args);
    }
  },
}));

vi.mock('server/src/lib/api/services/TimeSheetService', () => ({
  TimeSheetService: class {
    getById(...args: unknown[]) {
      return timeSheetGetByIdMock(...args);
    }
  },
}));

const { resolveTeamsTabAccessState } = await import('../../../../../../ee/server/src/lib/teams/resolveTeamsTabAccessState');

const readyState = {
  status: 'ready' as const,
  tenantId: 'tenant-1',
  userId: 'user-1',
  userName: 'Taylor Tech',
  userEmail: 'taylor@example.com',
  profileId: 'profile-1',
  microsoftTenantId: 'entra-tenant-1',
};

describe('resolveTeamsTabAccessState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockReset();
    ticketGetByIdMock.mockReset();
    projectTasksGetMock.mockReset();
    contactGetByIdMock.mockReset();
    timeEntryGetByIdMock.mockReset();
    timeSheetGetByIdMock.mockReset();
  });

  it('T177: runs existing permission checks and tenant-scoped entity lookups before granting Teams tab access to ticket, project-task, contact, time-entry, and approval destinations', async () => {
    hasPermissionMock.mockResolvedValue(true);
    ticketGetByIdMock.mockResolvedValue({ ticket_id: 'ticket-1' });
    projectTasksGetMock.mockResolvedValue([{ task_id: 'task-1' }]);
    contactGetByIdMock.mockResolvedValue({ contact_name_id: 'contact-1' });
    timeEntryGetByIdMock.mockResolvedValue({ entry_id: 'entry-1' });
    timeSheetGetByIdMock.mockResolvedValue({ id: 'approval-1' });

    await expect(
      resolveTeamsTabAccessState(readyState, { type: 'ticket', ticketId: 'ticket-1' })
    ).resolves.toEqual({ status: 'ready' });
    await expect(
      resolveTeamsTabAccessState(readyState, {
        type: 'project_task',
        projectId: 'project-1',
        taskId: 'task-1',
      })
    ).resolves.toEqual({ status: 'ready' });
    await expect(
      resolveTeamsTabAccessState(readyState, { type: 'contact', contactId: 'contact-1' })
    ).resolves.toEqual({ status: 'ready' });
    await expect(
      resolveTeamsTabAccessState(readyState, { type: 'time_entry', entryId: 'entry-1' })
    ).resolves.toEqual({ status: 'ready' });
    await expect(
      resolveTeamsTabAccessState(readyState, { type: 'approval', approvalId: 'approval-1' })
    ).resolves.toEqual({ status: 'ready' });
    await expect(resolveTeamsTabAccessState(readyState, { type: 'my_work' })).resolves.toEqual({
      status: 'ready',
    });

    expect(hasPermissionMock).toHaveBeenNthCalledWith(
      1,
      { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' },
      'ticket',
      'read'
    );
    expect(hasPermissionMock).toHaveBeenNthCalledWith(
      2,
      { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' },
      'project',
      'read'
    );
    expect(hasPermissionMock).toHaveBeenNthCalledWith(
      3,
      { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' },
      'contact',
      'read'
    );
    expect(hasPermissionMock).toHaveBeenNthCalledWith(
      4,
      { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' },
      'time_entry',
      'read'
    );
    expect(hasPermissionMock).toHaveBeenNthCalledWith(
      5,
      { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' },
      'timesheet',
      'approve'
    );

    expect(ticketGetByIdMock).toHaveBeenCalledWith('ticket-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(projectTasksGetMock).toHaveBeenCalledWith('project-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(contactGetByIdMock).toHaveBeenCalledWith('contact-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(timeEntryGetByIdMock).toHaveBeenCalledWith('entry-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(timeSheetGetByIdMock).toHaveBeenCalledWith('approval-1', { tenant: 'tenant-1', userId: 'user-1' });
  });

  it('T178: blocks Teams tab entity access when the user lacks permission or the linked record cannot be resolved for the tenant', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);

    await expect(
      resolveTeamsTabAccessState(readyState, { type: 'ticket', ticketId: 'ticket-1' })
    ).resolves.toEqual({
      status: 'forbidden',
      reason: 'missing_permission',
      message: 'You do not have permission to open tickets from Teams.',
    });
    expect(ticketGetByIdMock).not.toHaveBeenCalled();

    hasPermissionMock.mockResolvedValueOnce(true);
    projectTasksGetMock.mockResolvedValueOnce([{ task_id: 'task-2' }]);

    await expect(
      resolveTeamsTabAccessState(readyState, {
        type: 'project_task',
        projectId: 'project-1',
        taskId: 'task-1',
      })
    ).resolves.toEqual({
      status: 'forbidden',
      reason: 'not_found',
      message: 'That project task is unavailable or no longer matches this Teams link.',
    });

    hasPermissionMock.mockResolvedValueOnce(true);
    timeEntryGetByIdMock.mockResolvedValueOnce(null);

    await expect(
      resolveTeamsTabAccessState(readyState, { type: 'time_entry', entryId: 'entry-1' })
    ).resolves.toEqual({
      status: 'forbidden',
      reason: 'not_found',
      message: 'That time entry is unavailable or you no longer have access to it.',
    });
  });
});
