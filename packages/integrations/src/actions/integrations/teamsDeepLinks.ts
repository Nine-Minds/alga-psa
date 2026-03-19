export const TEAMS_PERSONAL_TAB_ENTITY_ID = 'alga-psa-personal-tab';

export type TeamsDeepLinkDestination =
  | { type: 'my_work' }
  | { type: 'ticket'; ticketId: string }
  | { type: 'project_task'; projectId: string; taskId: string }
  | { type: 'approval'; approvalId: string }
  | { type: 'time_entry'; entryId: string }
  | { type: 'contact'; contactId: string };

type TeamsDeepLinkSurface = 'tab' | 'notification' | 'bot' | 'message_extension';

function buildTeamsTabWebUrl(baseUrl: string, destination: TeamsDeepLinkDestination): string {
  switch (destination.type) {
    case 'my_work':
      return `${baseUrl}/teams/tab`;
    case 'ticket':
      return `${baseUrl}/msp/tickets/${destination.ticketId}`;
    case 'project_task':
      return `${baseUrl}/msp/projects/${destination.projectId}?taskId=${encodeURIComponent(destination.taskId)}`;
    case 'approval':
      return `${baseUrl}/msp/approvals/${destination.approvalId}`;
    case 'time_entry':
      return `${baseUrl}/msp/time?entryId=${encodeURIComponent(destination.entryId)}`;
    case 'contact':
      return `${baseUrl}/msp/contacts/${destination.contactId}`;
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
        : {
            page: 'project_task',
            projectId: destination.projectId,
            taskId: destination.taskId,
            source: surface,
          };
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
  }
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

export function buildTeamsPersonalTabDeepLink(
  baseUrl: string,
  appId: string,
  destination: TeamsDeepLinkDestination
): string {
  return buildTeamsPersonalTabDeepLinkForSurface(baseUrl, appId, destination, 'tab');
}
