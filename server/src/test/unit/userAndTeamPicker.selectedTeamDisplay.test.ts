import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../..');
const readFile = (relPath: string): string =>
  fs.readFileSync(path.join(root, relPath), 'utf8');

describe('UserAndTeamPicker selected team display', () => {
  it('renders a selected team label in the trigger instead of falling back to the placeholder', () => {
    const picker = readFile('packages/ui/src/components/UserAndTeamPicker.tsx');

    expect(picker).toContain("const currentTeam = teams.find(team => team.team_id === value);");
    expect(picker).toContain("const selectedLabel = currentUser");
    expect(picker).toContain("    : currentTeam");
    expect(picker).toContain("      ? currentTeam.team_name || 'Unnamed Team'");
    expect(picker).toContain("<span className={!hasSelection ? 'text-gray-400' : ''}>{selectedLabel}</span>");
  });

  it('renders a TeamAvatar in the trigger for selected teams and fetches that avatar even before the menu opens', () => {
    const picker = readFile('packages/ui/src/components/UserAndTeamPicker.tsx');

    expect(picker).toContain('if (currentTeam?.team_id) {');
    expect(picker).toContain('teamIds.add(currentTeam.team_id);');
    expect(picker).toContain('<TeamAvatar');
    expect(picker).toContain('teamId={currentTeam.team_id}');
    expect(picker).toContain('avatarUrl={teamAvatarUrls[currentTeam.team_id] ?? null}');
  });
});
