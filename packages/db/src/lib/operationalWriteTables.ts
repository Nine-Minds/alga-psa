/**
 * Tables whose writes are operational work, and so are refused while a
 * co-managed workspace is read-only, terminated or awaiting acceptance.
 *
 * This is a POSITIVE list: a table that is not listed stays writable. Queue,
 * ledger, audit and plumbing tables are deliberately absent, because a refusal
 * there would stop a read-only workspace from recording what it is allowed to do
 * (sign-in, export, license recovery, outbox delivery).
 *
 * Every entry carries a reason so a reviewer can challenge it. A forgotten
 * table is a silent under-refusal, so any card that adds a native write surface
 * adds its tables here. `RETAINED_COMMAND_TABLES` are listed so that the four
 * retained-command surfaces fail closed until L0c-b grants their carve-out.
 */
export interface OperationalWriteTable {
  /** Why a write to this table is operational work. */
  reason: string;
  /** Present when the table belongs to a retained-command surface (carve-out is L0c-b). */
  retainedCommand?: 'appointments' | 'teams-meetings' | 'scheduled-comments' | 'kb-import';
}

export const OPERATIONAL_WRITE_TABLES: Readonly<Record<string, OperationalWriteTable>> = {
  // Tickets
  tickets: { reason: 'ticket create/update/close is the core operational write' },
  comments: { reason: 'ticket comments (including scheduled comments) are operational conversation', retainedCommand: 'scheduled-comments' },
  comment_reactions: { reason: 'reactions on ticket comments' },
  comment_threads: { reason: 'comment thread structure' },
  ticket_resources: { reason: 'ticket assignment' },
  ticket_materials: { reason: 'materials billed against a ticket' },
  ticket_checklist_items: { reason: 'ticket checklist progress' },
  ticket_entity_links: { reason: 'links from a ticket to other entities' },
  ticket_comment_attachments: { reason: 'attachments on ticket comments' },
  asset_ticket_associations: { reason: 'asset-to-ticket association' },
  project_ticket_links: { reason: 'project-to-ticket association' },

  // Projects
  projects: { reason: 'project create/update/delete' },
  project_phases: { reason: 'project phase writes' },
  project_tasks: { reason: 'project task writes' },
  project_task_comments: { reason: 'project task comments' },
  project_task_comment_reactions: { reason: 'reactions on project task comments' },
  project_task_dependencies: { reason: 'project task dependency edges' },
  project_status_mappings: { reason: 'project status configuration' },
  project_team_assignments: { reason: 'project team assignment' },
  project_materials: { reason: 'materials billed against a project' },
  task_assignments: { reason: 'task assignment' },
  task_resources: { reason: 'task resource assignment' },
  task_checklist_items: { reason: 'task checklist progress' },

  // Assets
  assets: { reason: 'asset create/update/delete' },
  asset_associations: { reason: 'asset associations' },
  asset_relationships: { reason: 'asset relationships' },
  asset_document_associations: { reason: 'asset document associations' },
  asset_maintenance_schedules: { reason: 'asset maintenance scheduling' },
  asset_assignments: { reason: 'asset assignment' },

  // Credentials (vault): create/update/delete refused; reveal and read are reads.
  credentials: { reason: 'credential vault writes' },
  credential_associations: { reason: 'credential associations' },
  credential_access_grants: { reason: 'credential access grants' },

  // Documents and knowledge base
  documents: { reason: 'document create/update/delete' },
  document_associations: { reason: 'document associations' },
  document_versions: { reason: 'document versions' },
  document_folders: { reason: 'document folder structure' },
  kb_articles: { reason: 'knowledge-base article writes', retainedCommand: 'kb-import' },
  kb_article_reviewers: { reason: 'knowledge-base review workflow' },
  kb_import_files: { reason: 'knowledge-base import staging', retainedCommand: 'kb-import' },

  // Scheduling and time
  schedule_entries: { reason: 'dispatch and appointment entries', retainedCommand: 'appointments' },
  schedule_entry_assignees: { reason: 'dispatch and appointment assignees', retainedCommand: 'appointments' },
  appointment_requests: { reason: 'appointment requests', retainedCommand: 'appointments' },
  time_entries: { reason: 'time entry writes' },
  time_sheets: { reason: 'timesheet writes' },
  time_sheet_comments: { reason: 'timesheet comments' },
  time_tracking_sessions: { reason: 'running time tracking sessions' },

  // Teams meetings
  online_meetings: { reason: 'online (Teams) meeting records', retainedCommand: 'teams-meetings' },
  online_meeting_artifacts: { reason: 'online (Teams) meeting artifacts', retainedCommand: 'teams-meetings' },

  // Customer records worked on by technicians
  contacts: { reason: 'contact writes' },
  clients: { reason: 'client writes' },
  interactions: { reason: 'logged interactions' },
  tag_mappings: { reason: 'tagging of operational entities' },
};

/** Names of tables belonging to a retained-command surface. */
export const RETAINED_COMMAND_TABLES: readonly string[] = Object.entries(OPERATIONAL_WRITE_TABLES)
  .filter(([, entry]) => entry.retainedCommand)
  .map(([name]) => name);

export function isOperationalWriteTable(tableName: string): boolean {
  return Object.prototype.hasOwnProperty.call(OPERATIONAL_WRITE_TABLES, tableName);
}
