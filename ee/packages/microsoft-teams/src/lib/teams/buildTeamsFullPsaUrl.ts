import { recordPath } from '@alga-psa/types';
import type { TeamsTabDestination } from './resolveTeamsTabDestination';

export function buildTeamsFullPsaUrl(destination: TeamsTabDestination): string | null {
  switch (destination.type) {
    case 'ticket':
      // LEVERAGE: pattern record-links — record destinations come from the shared recordPath resolver.
      return recordPath('ticket', destination.ticketId);
    case 'project_task':
      // LEVERAGE: pattern record-links — canonical task path is the project page with ?taskId=.
      return recordPath('project_task', destination.taskId, { projectId: destination.projectId });
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
      return '/msp/dashboard';
    default:
      return null;
  }
}
