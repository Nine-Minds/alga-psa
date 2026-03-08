import type { ServiceContext } from '@alga-psa/db';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { ContactService } from 'server/src/lib/api/services/ContactService';
import { ProjectService } from 'server/src/lib/api/services/ProjectService';
import { TicketService } from 'server/src/lib/api/services/TicketService';
import { TimeEntryService } from 'server/src/lib/api/services/TimeEntryService';
import { TimeSheetService } from 'server/src/lib/api/services/TimeSheetService';
import type { TeamsTabAuthState } from './resolveTeamsTabAuthState';
import type { TeamsTabDestination } from './resolveTeamsTabDestination';

type TeamsTabReadyAuthState = Extract<TeamsTabAuthState, { status: 'ready' }>;

export type TeamsTabAccessState =
  | { status: 'ready' }
  | {
      status: 'forbidden';
      reason: 'missing_permission' | 'not_found';
      message: string;
    };

const ticketService = new TicketService();
const projectService = new ProjectService();
const contactService = new ContactService();
const timeEntryService = new TimeEntryService();
const timeSheetService = new TimeSheetService();

function buildPermissionUser(state: TeamsTabReadyAuthState) {
  return {
    user_id: state.userId,
    user_type: 'internal' as const,
    tenant: state.tenantId,
  };
}

function buildServiceContext(state: TeamsTabReadyAuthState): ServiceContext {
  return {
    tenant: state.tenantId,
    userId: state.userId,
  } as ServiceContext;
}

async function requirePermission(
  state: TeamsTabReadyAuthState,
  resource: string,
  action: string,
  message: string
): Promise<TeamsTabAccessState | null> {
  const allowed = await hasPermission(buildPermissionUser(state), resource, action);
  if (allowed) {
    return null;
  }

  return {
    status: 'forbidden',
    reason: 'missing_permission',
    message,
  };
}

export async function resolveTeamsTabAccessState(
  state: TeamsTabReadyAuthState,
  destination: TeamsTabDestination
): Promise<TeamsTabAccessState> {
  const context = buildServiceContext(state);

  switch (destination.type) {
    case 'my_work':
      return { status: 'ready' };

    case 'ticket': {
      const permissionFailure = await requirePermission(
        state,
        'ticket',
        'read',
        'You do not have permission to open tickets from Teams.'
      );
      if (permissionFailure) {
        return permissionFailure;
      }

      const ticket = await ticketService.getById(destination.ticketId, context);
      return ticket
        ? { status: 'ready' }
        : {
            status: 'forbidden',
            reason: 'not_found',
            message: 'That ticket is unavailable or you no longer have access to it.',
          };
    }

    case 'project_task': {
      const permissionFailure = await requirePermission(
        state,
        'project',
        'read',
        'You do not have permission to open project tasks from Teams.'
      );
      if (permissionFailure) {
        return permissionFailure;
      }

      try {
        const tasks = await projectService.getTasks(destination.projectId, context);
        return tasks.some((task) => task.task_id === destination.taskId)
          ? { status: 'ready' }
          : {
              status: 'forbidden',
              reason: 'not_found',
              message: 'That project task is unavailable or no longer matches this Teams link.',
            };
      } catch {
        return {
          status: 'forbidden',
          reason: 'not_found',
          message: 'That project task is unavailable or no longer matches this Teams link.',
        };
      }
    }

    case 'approval': {
      const permissionFailure = await requirePermission(
        state,
        'timesheet',
        'approve',
        'You do not have permission to open approval work from Teams.'
      );
      if (permissionFailure) {
        return permissionFailure;
      }

      const approval = await timeSheetService.getById(destination.approvalId, context);
      return approval
        ? { status: 'ready' }
        : {
            status: 'forbidden',
            reason: 'not_found',
            message: 'That approval item is unavailable or you no longer have access to it.',
          };
    }

    case 'time_entry': {
      const permissionFailure = await requirePermission(
        state,
        'time_entry',
        'read',
        'You do not have permission to open time entries from Teams.'
      );
      if (permissionFailure) {
        return permissionFailure;
      }

      const entry = await timeEntryService.getById(destination.entryId, context);
      return entry
        ? { status: 'ready' }
        : {
            status: 'forbidden',
            reason: 'not_found',
            message: 'That time entry is unavailable or you no longer have access to it.',
          };
    }

    case 'contact': {
      const permissionFailure = await requirePermission(
        state,
        'contact',
        'read',
        'You do not have permission to open contacts from Teams.'
      );
      if (permissionFailure) {
        return permissionFailure;
      }

      const contact = await contactService.getById(destination.contactId, context);
      return contact
        ? { status: 'ready' }
        : {
            status: 'forbidden',
            reason: 'not_found',
            message: 'That contact is unavailable or you no longer have access to it.',
          };
    }
  }
}
