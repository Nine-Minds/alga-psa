import { describe, expect, it } from 'vitest';
import {
  getTeamsManifestBotCommands,
  levenshteinDistance,
  suggestTeamsBotCommand,
  TEAMS_BOT_COMMAND_DEFINITIONS,
  TEAMS_MANIFEST_BOT_COMMAND_LIMIT,
} from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsBotCommands';

describe('teamsBotCommands (single source of truth)', () => {
  it('T074: the manifest bot command list is derived from the shared definitions', () => {
    const manifestCommands = getTeamsManifestBotCommands();
    const expected = TEAMS_BOT_COMMAND_DEFINITIONS.filter((definition) => definition.inManifest).map(
      (definition) => ({ title: definition.title, description: definition.description })
    );

    expect(manifestCommands).toEqual(expected);
    // Teams caps bot command lists at 10 items.
    expect(manifestCommands.length).toBeLessThanOrEqual(TEAMS_MANIFEST_BOT_COMMAND_LIMIT);

    const titles = manifestCommands.map((command) => command.title);
    expect(titles).toContain('my approvals');
    expect(titles).toContain('new ticket <title>');
    expect(titles).toContain('approve approval <n>');
    // Manifest titles must fit the Teams 32-char cap.
    for (const title of titles) {
      expect(title.length).toBeLessThanOrEqual(32);
    }
  });

  it('T074: every definition maps to a registry action or is the help command', () => {
    const registryActionIds = new Set([
      'my_tickets',
      'my_approvals',
      'open_record',
      'create_ticket_from_message',
      'update_from_message',
      'assign_ticket',
      'add_note',
      'reply_to_contact',
      'log_time',
      'approval_response',
    ]);

    for (const definition of TEAMS_BOT_COMMAND_DEFINITIONS) {
      if (definition.requiredAction) {
        expect(registryActionIds.has(definition.requiredAction), definition.id).toBe(true);
      } else {
        expect(definition.id).toBe('help');
      }
    }
  });

  it('T068: near-miss suggestion matches misspelled command words within distance 2', () => {
    expect(levenshteinDistance('assing', 'assign')).toBeLessThanOrEqual(2);
    expect(suggestTeamsBotCommand('assing ticket 12')?.id).toBe('assign_ticket');
    expect(suggestTeamsBotCommand('my ticket')?.id).toBe('my_tickets');
    expect(suggestTeamsBotCommand('close every ticket')).toBeNull();
    expect(suggestTeamsBotCommand('')).toBeNull();
  });
});
