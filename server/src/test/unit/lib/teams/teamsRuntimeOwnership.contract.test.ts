import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');

function repoPath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

describe('teams runtime EE ownership', () => {
  it('T167/T169/T171/T173/T185/T187: keeps concrete Teams runtime helpers under ee/server ownership', () => {
    expect(fs.existsSync(repoPath('server/src/lib/teams/bot/teamsBotHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/quickActions/teamsQuickActionHandler.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTenantContext.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/handleTeamsAuthCallback.ts'))).toBe(false);
    expect(fs.existsSync(repoPath('server/src/lib/teams/resolveTeamsTabAuthState.ts'))).toBe(false);

    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/bot/teamsBotHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/messageExtension/teamsMessageExtensionHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/quickActions/teamsQuickActionHandler.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTenantContext.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/handleTeamsAuthCallback.ts'))).toBe(true);
    expect(fs.existsSync(repoPath('ee/server/src/lib/teams/resolveTeamsTabAuthState.ts'))).toBe(true);
  });
});
