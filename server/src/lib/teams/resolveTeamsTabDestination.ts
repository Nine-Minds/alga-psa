export type TeamsTabDestination =
  | { type: 'my_work' }
  | { type: 'ticket'; ticketId: string }
  | { type: 'project_task'; projectId: string; taskId: string }
  | { type: 'approval'; approvalId: string }
  | { type: 'time_entry'; entryId: string }
  | { type: 'contact'; contactId: string };

type SearchParams = Record<string, string | string[] | undefined>;

function getSingleSearchParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getSafeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseTeamsContext(contextValue: string | undefined): Record<string, unknown> | null {
  if (!contextValue) {
    return null;
  }

  try {
    return getSafeRecord(JSON.parse(contextValue));
  } catch {
    return null;
  }
}

function getContextString(context: Record<string, unknown> | null, key: string): string | undefined {
  if (!context) {
    return undefined;
  }

  const value = context[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveTeamsTabDestination(params?: SearchParams): TeamsTabDestination {
  const context = parseTeamsContext(getSingleSearchParam(params?.context));
  const page = getContextString(context, 'page') || getSingleSearchParam(params?.page) || 'my_work';

  switch (page) {
    case 'ticket': {
      const ticketId = getContextString(context, 'ticketId') || getSingleSearchParam(params?.ticketId);
      return ticketId ? { type: 'ticket', ticketId } : { type: 'my_work' };
    }
    case 'project_task': {
      const projectId = getContextString(context, 'projectId') || getSingleSearchParam(params?.projectId);
      const taskId = getContextString(context, 'taskId') || getSingleSearchParam(params?.taskId);
      return projectId && taskId ? { type: 'project_task', projectId, taskId } : { type: 'my_work' };
    }
    case 'approval': {
      const approvalId = getContextString(context, 'approvalId') || getSingleSearchParam(params?.approvalId);
      return approvalId ? { type: 'approval', approvalId } : { type: 'my_work' };
    }
    case 'time_entry': {
      const entryId = getContextString(context, 'entryId') || getSingleSearchParam(params?.entryId);
      return entryId ? { type: 'time_entry', entryId } : { type: 'my_work' };
    }
    case 'contact': {
      const contactId = getContextString(context, 'contactId') || getSingleSearchParam(params?.contactId);
      return contactId ? { type: 'contact', contactId } : { type: 'my_work' };
    }
    default:
      return { type: 'my_work' };
  }
}

export function describeTeamsTabDestination(destination: TeamsTabDestination): {
  title: string;
  summary: string;
} {
  switch (destination.type) {
    case 'ticket':
      return {
        title: 'Ticket',
        summary: `Deep link bootstrap is ready for ticket ${destination.ticketId}.`,
      };
    case 'project_task':
      return {
        title: 'Project task',
        summary: `Deep link bootstrap is ready for project ${destination.projectId} task ${destination.taskId}.`,
      };
    case 'approval':
      return {
        title: 'Approval',
        summary: `Deep link bootstrap is ready for approval ${destination.approvalId}.`,
      };
    case 'time_entry':
      return {
        title: 'Time entry',
        summary: `Deep link bootstrap is ready for time entry ${destination.entryId}.`,
      };
    case 'contact':
      return {
        title: 'Contact',
        summary: `Deep link bootstrap is ready for contact ${destination.contactId}.`,
      };
    case 'my_work':
    default:
      return {
        title: 'My work',
        summary: 'Your Teams personal tab is ready to load your PSA work queue.',
      };
  }
}
