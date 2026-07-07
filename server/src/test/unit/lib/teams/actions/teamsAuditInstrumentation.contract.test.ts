import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Teams action audit instrumentation contract', () => {
  const registry = readRepoFile('ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionRegistry.ts');
  const botHandler = readRepoFile('ee/packages/microsoft-teams/src/lib/teams/bot/teamsBotHandler.ts');
  const messageExtensionHandler = readRepoFile('ee/packages/microsoft-teams/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts');
  const quickActionHandler = readRepoFile('ee/packages/microsoft-teams/src/lib/teams/quickActions/teamsQuickActionHandler.ts');

  it('registers all seven mutation action ids for audit recording', () => {
    for (const actionId of [
      'assign_ticket',
      'add_note',
      'reply_to_contact',
      'log_time',
      'approval_response',
      'create_ticket_from_message',
      'update_from_message',
    ]) {
      expect(registry).toContain(`'${actionId}'`);
    }
    expect(registry).toContain('const AUDITED_MUTATION_ACTION_IDS = new Set<TeamsActionId>');
  });

  it('records audit events for success, authorization failure, availability failure, and caught failure paths', () => {
    expect(registry.match(/recordTeamsMutationAudit/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(registry).toContain("resultStatus: 'success'");
    expect(registry).toContain("resultStatus: 'failure'");
    expect(registry).toContain('errorCode: result.error.code');
    expect(registry).toContain('writeTeamsAuditEvent');
  });

  it('threads the verified Microsoft user id from Teams bot, message extension, and quick-action activities into action requests', () => {
    // Since the E1 inbound-security hardening, the Microsoft user id is
    // sourced from the verified Bot Framework token claim first and only
    // falls back to the activity body when no verified identity is present.
    expect(registry).toContain('microsoftUserId?: string | null');
    expect(botHandler).toContain('microsoftUserId: params.microsoftUserId');
    expect(botHandler).toMatch(/verifiedIdentity\?\.microsoftUserId/);
    expect(messageExtensionHandler).toContain('microsoftUserId: params.microsoftUserId');
    expect(messageExtensionHandler).toMatch(/verifiedIdentity\?\.microsoftUserId\s*\|\|\s*getMicrosoftAccountId\(activity\)/);
    expect(quickActionHandler).toContain('microsoftUserId: params.microsoftUserId');
    expect(quickActionHandler).toMatch(/verifiedIdentity\?\.microsoftUserId\s*\|\|\s*getMicrosoftAccountId\(activity\)/);
  });
});
