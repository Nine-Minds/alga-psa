export const TEAMS_PERSONAL_TAB_ENTITY_ID = 'alga-psa-personal-tab';

export type TeamsDeepLinkDestination =
  | { type: 'my_work' }
  | { type: 'ticket'; ticketId: string }
  | { type: 'project_task'; projectId: string; taskId: string }
  | { type: 'approval'; approvalId: string }
  | { type: 'time_entry'; entryId: string }
  | { type: 'contact'; contactId: string };

export type TeamsDeepLinkSurface = 'tab' | 'notification' | 'bot' | 'message_extension';

function buildTeamsTabWebUrl(baseUrl: string, destination: TeamsDeepLinkDestination): string {
  // Build a Teams-tab URL with query params that resolveTeamsTabDestination()
  // can read server-side. Using the tab URL (instead of the raw PSA URL)
  // ensures the destination context survives regardless of how Teams delivers
  // the deep link to the tab page.
  const tabBase = `${baseUrl}/teams/tab`;
  switch (destination.type) {
    case 'my_work':
      return tabBase;
    case 'ticket':
      return `${tabBase}?page=ticket&ticketId=${encodeURIComponent(destination.ticketId)}`;
    case 'project_task':
      return `${tabBase}?page=project_task&projectId=${encodeURIComponent(destination.projectId)}&taskId=${encodeURIComponent(destination.taskId)}`;
    case 'approval':
      return `${tabBase}?page=approval&approvalId=${encodeURIComponent(destination.approvalId)}`;
    case 'time_entry':
      return `${tabBase}?page=time_entry&entryId=${encodeURIComponent(destination.entryId)}`;
    case 'contact':
      return `${tabBase}?page=contact&contactId=${encodeURIComponent(destination.contactId)}`;
    default: {
      const exhaustive: never = destination;
      throw new Error(`Unsupported Teams deep-link destination: ${(exhaustive as any).type}`);
    }
  }
}

function buildTeamsTabContext(
  destination: TeamsDeepLinkDestination,
  surface: TeamsDeepLinkSurface = 'tab'
): Record<string, string> {
  switch (destination.type) {
    case 'my_work':
      return surface === 'tab' ? { page: 'my_work' } : { page: 'my_work', source: surface };
    case 'ticket':
      return surface === 'tab'
        ? { page: 'ticket', ticketId: destination.ticketId }
        : { page: 'ticket', ticketId: destination.ticketId, source: surface };
    case 'project_task':
      return surface === 'tab'
        ? { page: 'project_task', projectId: destination.projectId, taskId: destination.taskId }
        : { page: 'project_task', projectId: destination.projectId, taskId: destination.taskId, source: surface };
    case 'approval':
      return surface === 'tab'
        ? { page: 'approval', approvalId: destination.approvalId }
        : { page: 'approval', approvalId: destination.approvalId, source: surface };
    case 'time_entry':
      return surface === 'tab'
        ? { page: 'time_entry', entryId: destination.entryId }
        : { page: 'time_entry', entryId: destination.entryId, source: surface };
    case 'contact':
      return surface === 'tab'
        ? { page: 'contact', contactId: destination.contactId }
        : { page: 'contact', contactId: destination.contactId, source: surface };
    default: {
      const exhaustive: never = destination;
      throw new Error(`Unsupported Teams deep-link destination: ${(exhaustive as any).type}`);
    }
  }
}

function resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl: string): TeamsDeepLinkDestination {
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
    return { type: 'contact', contactId: segments[2] };
  }

  return { type: 'my_work' };
}

function buildTeamsPersonalTabDeepLinkForSurface(
  baseUrl: string,
  appId: string,
  destination: TeamsDeepLinkDestination,
  surface: TeamsDeepLinkSurface
): string {
  const params = new URLSearchParams({
    webUrl: buildTeamsTabWebUrl(baseUrl, destination),
    context: JSON.stringify(buildTeamsTabContext(destination, surface)),
  });
  return `https://teams.microsoft.com/l/entity/${encodeURIComponent(appId)}/${encodeURIComponent(TEAMS_PERSONAL_TAB_ENTITY_ID)}?${params.toString()}`;
}

export function buildTeamsPersonalTabDeepLink(baseUrl: string, appId: string, destination: TeamsDeepLinkDestination): string {
  return buildTeamsPersonalTabDeepLinkForSurface(baseUrl, appId, destination, 'tab');
}

export function buildTeamsPersonalTabDeepLinkFromPsaUrl(baseUrl: string, appId: string, psaUrl: string): string {
  return buildTeamsPersonalTabDeepLink(baseUrl, appId, resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl));
}

export function buildTeamsBotResultDeepLinkFromPsaUrl(baseUrl: string, appId: string, psaUrl: string): string {
  return buildTeamsPersonalTabDeepLinkForSurface(baseUrl, appId, resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl), 'bot');
}

export function buildTeamsMessageExtensionResultDeepLinkFromPsaUrl(
  baseUrl: string,
  appId: string,
  psaUrl: string
): string {
  return buildTeamsPersonalTabDeepLinkForSurface(
    baseUrl,
    appId,
    resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl),
    'message_extension'
  );
}
