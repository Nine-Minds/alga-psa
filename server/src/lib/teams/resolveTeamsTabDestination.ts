export type TeamsTabDestination =
  | { type: 'my_work' }
  | { type: 'ticket'; ticketId: string }
  | { type: 'project_task'; projectId: string; taskId: string }
  | { type: 'approval'; approvalId: string }
  | { type: 'time_entry'; entryId: string }
  | { type: 'contact'; contactId: string; clientId?: string };

export type TeamsTabEntrySource = 'tab' | 'notification' | 'bot' | 'message_extension';

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

function resolveDestinationLink(params?: SearchParams): string | undefined {
  return (
    getSingleSearchParam(params?.botResultLink) ||
    getSingleSearchParam(params?.messageExtensionResultLink) ||
    getSingleSearchParam(params?.notificationLink) ||
    getSingleSearchParam(params?.link) ||
    getSingleSearchParam(params?.webUrl)
  );
}

export function resolveTeamsTabEntrySource(params?: SearchParams): TeamsTabEntrySource {
  const context = parseTeamsContext(getSingleSearchParam(params?.context));
  const explicitSource =
    getContextString(context, 'source') ||
    getSingleSearchParam(params?.source) ||
    getSingleSearchParam(params?.surface);

  switch (explicitSource) {
    case 'notification':
      return 'notification';
    case 'bot':
      return 'bot';
    case 'message_extension':
      return 'message_extension';
  }

  if (getSingleSearchParam(params?.botResultLink)) {
    return 'bot';
  }

  if (getSingleSearchParam(params?.messageExtensionResultLink)) {
    return 'message_extension';
  }

  if (getSingleSearchParam(params?.notificationLink)) {
    return 'notification';
  }

  return 'tab';
}

export function resolveTeamsTabDestinationFromPsaUrl(psaUrl: string | undefined): TeamsTabDestination {
  if (!psaUrl) {
    return { type: 'my_work' };
  }

  let parsed: URL;
  try {
    parsed = new URL(psaUrl, 'https://teams.alga.invalid');
  } catch {
    return { type: 'my_work' };
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] !== 'msp') {
    return { type: 'my_work' };
  }

  if (segments[1] === 'tickets' && segments[2]) {
    return { type: 'ticket', ticketId: segments[2] };
  }

  if (segments[1] === 'projects' && segments[2]) {
    const taskId = parsed.searchParams.get('taskId')?.trim();
    return taskId ? { type: 'project_task', projectId: segments[2], taskId } : { type: 'my_work' };
  }

  if (segments[1] === 'time-sheet-approvals') {
    const approvalId = parsed.searchParams.get('approvalId')?.trim();
    return approvalId ? { type: 'approval', approvalId } : { type: 'my_work' };
  }

  if (segments[1] === 'time-entry' || segments[1] === 'time') {
    const entryId = parsed.searchParams.get('entryId')?.trim();
    return entryId ? { type: 'time_entry', entryId } : { type: 'my_work' };
  }

  if (segments[1] === 'contacts' && segments[2]) {
    const clientId = parsed.searchParams.get('clientId')?.trim() || undefined;
    return { type: 'contact', contactId: segments[2], clientId };
  }

  return { type: 'my_work' };
}

export function resolveTeamsTabDestination(params?: SearchParams): TeamsTabDestination {
  const context = parseTeamsContext(getSingleSearchParam(params?.context));
  const page = getContextString(context, 'page') || getSingleSearchParam(params?.page);

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
      const clientId = getContextString(context, 'clientId') || getSingleSearchParam(params?.clientId);
      return contactId ? { type: 'contact', contactId, clientId } : { type: 'my_work' };
    }
  }

  const destinationLink = resolveDestinationLink(params);

  if (destinationLink) {
    return resolveTeamsTabDestinationFromPsaUrl(destinationLink);
  }

  return { type: 'my_work' };
}

export function describeTeamsTabDestination(destination: TeamsTabDestination): {
  title: string;
  summary: string;
} {
  switch (destination.type) {
    case 'ticket':
      return {
        title: `Ticket ${destination.ticketId}`,
        summary: `You're opening ticket ${destination.ticketId} from Teams.`,
      };
    case 'project_task':
      return {
        title: `Project task ${destination.taskId}`,
        summary: `You're opening task ${destination.taskId} in project ${destination.projectId}.`,
      };
    case 'approval':
      return {
        title: `Approval ${destination.approvalId}`,
        summary: `You're opening approval ${destination.approvalId} from Teams.`,
      };
    case 'time_entry':
      return {
        title: `Time entry ${destination.entryId}`,
        summary: `You're opening time entry ${destination.entryId} from Teams.`,
      };
    case 'contact':
      return {
        title: `Contact ${destination.contactId}`,
        summary: destination.clientId
          ? `You're opening contact ${destination.contactId} for client ${destination.clientId} from Teams.`
          : `You're opening contact ${destination.contactId} from Teams.`,
      };
    case 'my_work':
    default:
      return {
        title: 'My work',
        summary: 'Your Teams personal tab is ready to load your PSA work queue.',
      };
  }
}
