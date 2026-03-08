import type { TeamsTabDestination } from './resolveTeamsTabDestination';

export function buildTeamsFullPsaUrl(destination: TeamsTabDestination): string | null {
  switch (destination.type) {
    case 'ticket':
      return `/msp/tickets/${destination.ticketId}`;
    case 'project_task': {
      const query = new URLSearchParams({ taskId: destination.taskId });
      return `/msp/projects/${destination.projectId}?${query.toString()}`;
    }
    case 'approval': {
      const query = new URLSearchParams({ approvalId: destination.approvalId });
      return `/msp/time-sheet-approvals?${query.toString()}`;
    }
    case 'time_entry': {
      const query = new URLSearchParams({ entryId: destination.entryId });
      return `/msp/time-entry?${query.toString()}`;
    }
    case 'contact':
      return `/msp/contacts/${destination.contactId}`;
    case 'my_work':
    default:
      return null;
  }
}
