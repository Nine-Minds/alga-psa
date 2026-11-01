/**
 * Authorization-kernel record contexts for tickets and projects.
 *
 * Shared by the API controllers and the document-attachment entity adapters so
 * that "can this caller read this record" is answered the same way everywhere.
 */

// A ticket is "assigned" only to its primary `assigned_to` for read authorization.
// Do not trust `ticket_resources.additional_user_id` as a read grant because
// time-entry workflows can create those rows without ticket row-level authorization.
export function buildTicketRecordContext(ticket: Record<string, any>) {
  return {
    id: ticket.ticket_id,
    ownerUserId: typeof ticket.entered_by === 'string' ? ticket.entered_by : undefined,
    assignedUserIds: typeof ticket.assigned_to === 'string' ? [ticket.assigned_to] : [],
    clientId: typeof ticket.client_id === 'string' ? ticket.client_id : undefined,
    boardId: typeof ticket.board_id === 'string' ? ticket.board_id : undefined,
    teamIds: typeof ticket.assigned_team_id === 'string' ? [ticket.assigned_team_id] : [],
    statusId: ticket.status_id,
  };
}

export function buildProjectRecordContext(project: Record<string, any>) {
  return {
    id: project.project_id,
    ownerUserId: typeof project.assigned_to === 'string' ? project.assigned_to : undefined,
    assignedUserIds: typeof project.assigned_to === 'string' ? [project.assigned_to] : [],
    clientId: typeof project.client_id === 'string' ? project.client_id : undefined,
    status: project.status,
    isClosed: project.is_closed,
  };
}
