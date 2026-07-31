import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.fn();
const getTeamsTicketByIdMock = vi.fn();
const listTeamsProjectTasksMock = vi.fn();
const getTeamsContactByIdMock = vi.fn();
const getTeamsTimeEntryByIdMock = vi.fn();
const getTeamsApprovalByIdMock = vi.fn();
const getTeamsProjectTaskByIdMock = vi.fn();

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/teamsPsaData', () => ({
  getTeamsTicketById: (...args: unknown[]) => getTeamsTicketByIdMock(...args),
  listTeamsProjectTasks: (...args: unknown[]) => listTeamsProjectTasksMock(...args),
  getTeamsContactById: (...args: unknown[]) => getTeamsContactByIdMock(...args),
  getTeamsTimeEntryById: (...args: unknown[]) => getTeamsTimeEntryByIdMock(...args),
  getTeamsApprovalById: (...args: unknown[]) => getTeamsApprovalByIdMock(...args),
  getTeamsProjectTaskById: (...args: unknown[]) => getTeamsProjectTaskByIdMock(...args),
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

const permissionUser = {
  user_id: 'user-1',
  username: 'user-1',
  email: '',
  is_inactive: false,
  user_type: 'internal',
  tenant: 'tenant-1',
};

describe('resolveTeamsTabAccessState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockReset();
    getTeamsTicketByIdMock.mockReset();
    listTeamsProjectTasksMock.mockReset();
    getTeamsContactByIdMock.mockReset();
    getTeamsTimeEntryByIdMock.mockReset();
    getTeamsApprovalByIdMock.mockReset();
    getTeamsProjectTaskByIdMock.mockReset();
  });

  it('T177: runs existing permission checks and tenant-scoped entity lookups before granting Teams tab access to ticket, project-task, contact, time-entry, and approval destinations', async () => {
    hasPermissionMock.mockResolvedValue(true);
    getTeamsTicketByIdMock.mockResolvedValue({ ticket_id: 'ticket-1' });
    listTeamsProjectTasksMock.mockResolvedValue([{ task_id: 'task-1' }]);
    getTeamsContactByIdMock.mockResolvedValue({ contact_name_id: 'contact-1' });
    getTeamsTimeEntryByIdMock.mockResolvedValue({ entry_id: 'entry-1' });
    getTeamsApprovalByIdMock.mockResolvedValue({ id: 'approval-1' });

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

    expect(hasPermissionMock).toHaveBeenNthCalledWith(1, permissionUser, 'ticket', 'read');
    expect(hasPermissionMock).toHaveBeenNthCalledWith(2, permissionUser, 'project', 'read');
    expect(hasPermissionMock).toHaveBeenNthCalledWith(3, permissionUser, 'contact', 'read');
    expect(hasPermissionMock).toHaveBeenNthCalledWith(4, permissionUser, 'time_entry', 'read');
    expect(hasPermissionMock).toHaveBeenNthCalledWith(5, permissionUser, 'timesheet', 'approve');

    expect(getTeamsTicketByIdMock).toHaveBeenCalledWith('ticket-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(listTeamsProjectTasksMock).toHaveBeenCalledWith('project-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(getTeamsContactByIdMock).toHaveBeenCalledWith('contact-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(getTeamsTimeEntryByIdMock).toHaveBeenCalledWith('entry-1', { tenant: 'tenant-1', userId: 'user-1' });
    expect(getTeamsApprovalByIdMock).toHaveBeenCalledWith('approval-1', { tenant: 'tenant-1', userId: 'user-1' });
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
    expect(getTeamsTicketByIdMock).not.toHaveBeenCalled();

    hasPermissionMock.mockResolvedValueOnce(true);
    listTeamsProjectTasksMock.mockResolvedValueOnce([{ task_id: 'task-2' }]);

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
    getTeamsTimeEntryByIdMock.mockResolvedValueOnce(null);

    await expect(
      resolveTeamsTabAccessState(readyState, { type: 'time_entry', entryId: 'entry-1' })
    ).resolves.toEqual({
      status: 'forbidden',
      reason: 'not_found',
      message: 'That time entry is unavailable or you no longer have access to it.',
    });
  });
});
