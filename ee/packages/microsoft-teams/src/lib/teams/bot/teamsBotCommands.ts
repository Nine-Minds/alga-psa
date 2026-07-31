import type { TeamsActionId } from '../actions/teamsActionRegistry';

/**
 * Single source of truth for the Teams bot command surface.
 *
 * - The bot handler builds its help card and near-miss suggestions from this
 *   list.
 * - The Teams app package manifest derives its bot command list from the same
 *   definitions (Teams caps bot command lists at 10 items — `inManifest`
 *   marks the 10 most useful commands).
 */
export interface TeamsBotCommandDefinition {
  /** Stable command identifier. */
  id: string;
  /** Short manifest-safe title (Teams caps command titles at 32 chars). */
  title: string;
  description: string;
  /** Full example syntax shown on the help card and in prompts. */
  example: string;
  /** Leading phrase the parser recognizes; used for near-miss suggestions. */
  trigger: string;
  /** Registry action gating help-card visibility (RBAC-aware help). */
  requiredAction?: TeamsActionId;
  /** Read-only commands are always shown on the help card. */
  readOnly?: boolean;
  /** Included in the Teams manifest bot command list (max 10). */
  inManifest: boolean;
}

export const TEAMS_BOT_COMMAND_DEFINITIONS: TeamsBotCommandDefinition[] = [
  {
    id: 'help',
    title: 'help',
    description: 'Show the commands available to you.',
    example: 'help',
    trigger: 'help',
    readOnly: true,
    inManifest: true,
  },
  {
    id: 'my_tickets',
    title: 'my tickets',
    description: 'Show the technician work queue.',
    example: 'my tickets',
    trigger: 'my tickets',
    requiredAction: 'my_tickets',
    readOnly: true,
    inManifest: true,
  },
  {
    id: 'my_approvals',
    title: 'my approvals',
    description: 'List time-sheet approvals waiting on you.',
    example: 'my approvals',
    trigger: 'my approvals',
    requiredAction: 'my_approvals',
    inManifest: true,
  },
  {
    id: 'ticket',
    title: 'ticket <number>',
    description: 'Open a ticket by number, or search by title.',
    example: 'ticket <number>',
    trigger: 'ticket',
    requiredAction: 'open_record',
    readOnly: true,
    inManifest: true,
  },
  {
    id: 'new_ticket',
    title: 'new ticket <title>',
    description: 'Create a ticket from chat (optionally: for <client>).',
    example: 'new ticket <title>',
    trigger: 'new ticket',
    requiredAction: 'create_ticket_from_message',
    inManifest: true,
  },
  {
    id: 'assign_ticket',
    title: 'assign ticket <number> to me',
    description: 'Assign a ticket from Teams.',
    example: 'assign ticket <number> to me',
    trigger: 'assign ticket',
    requiredAction: 'assign_ticket',
    inManifest: true,
  },
  {
    id: 'add_note',
    title: 'add note <number>: <note>',
    description: 'Append an internal note.',
    example: 'add note <number>: <note>',
    trigger: 'add note',
    requiredAction: 'add_note',
    inManifest: true,
  },
  {
    id: 'reply_to_contact',
    title: 'reply to contact <number>',
    description: 'Send a customer-facing reply.',
    example: 'reply to contact <number>: <reply>',
    trigger: 'reply to contact',
    requiredAction: 'reply_to_contact',
    inManifest: true,
  },
  {
    id: 'log_time',
    title: 'log time ticket <number>',
    description: 'Create a time entry.',
    example: 'log time ticket <number> 30m: <note>',
    trigger: 'log time',
    requiredAction: 'log_time',
    inManifest: true,
  },
  {
    id: 'approve_approval',
    title: 'approve approval <n>',
    description: 'Approve a pending time-sheet approval.',
    example: 'approve approval <n>',
    trigger: 'approve approval',
    requiredAction: 'approval_response',
    inManifest: true,
  },
  {
    id: 'request_changes_approval',
    title: 'request changes approval <n>',
    description: 'Return an approval with requested changes.',
    example: 'request changes approval <n>: <comment>',
    trigger: 'request changes approval',
    requiredAction: 'approval_response',
    inManifest: false,
  },
];

export const TEAMS_MANIFEST_BOT_COMMAND_LIMIT = 10;

/** Manifest bot command list — derived from the shared definitions. */
export function getTeamsManifestBotCommands(): Array<{ title: string; description: string }> {
  return TEAMS_BOT_COMMAND_DEFINITIONS.filter((definition) => definition.inManifest)
    .slice(0, TEAMS_MANIFEST_BOT_COMMAND_LIMIT)
    .map((definition) => ({
      title: definition.title,
      description: definition.description,
    }));
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

const NEAR_MISS_MAX_DISTANCE = 2;

/**
 * Near-miss command suggestion: compare the first 1-3 words of the message
 * against each command trigger phrase and return the closest definition when
 * the edit distance is small enough to look like a typo.
 */
export function suggestTeamsBotCommand(text: string): TeamsBotCommandDefinition | null {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words[0].length < 2) {
    return null;
  }

  let best: { definition: TeamsBotCommandDefinition; distance: number } | null = null;
  for (const definition of TEAMS_BOT_COMMAND_DEFINITIONS) {
    const triggerWords = definition.trigger.toLowerCase().split(/\s+/).slice(0, 3);
    const candidate = words.slice(0, triggerWords.length).join(' ');
    const distance = levenshteinDistance(candidate, triggerWords.join(' '));
    if (distance <= NEAR_MISS_MAX_DISTANCE && (!best || distance < best.distance)) {
      best = { definition, distance };
    }
  }

  return best?.definition ?? null;
}
