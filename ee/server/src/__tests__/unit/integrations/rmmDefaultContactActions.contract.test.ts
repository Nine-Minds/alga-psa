import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('RMM default contact action contracts', () => {
  it('T030/T031/T032: Huntress mappings expose and persist default_contact_id without bypassing gating', () => {
    const source = readRepoFile('ee/server/src/lib/actions/integrations/huntressActions.ts');
    const types = readRepoFile('ee/server/src/interfaces/rmm.interfaces.ts');

    expect(types).toContain('default_contact_id?: string | null');
    expect(source).toContain('export const getHuntressOrganizationMappings = withHuntressAccess');
    expect(source).toContain(".select('rom.*', 'c.client_name as company_name')");
    expect(source).toContain('await requireSettingsUpdatePermission(user)');
    expect(source).toContain('default_contact_id?: string | null');
    expect(source).toContain('if (updates.default_contact_id !== undefined)');
    expect(source).toContain('changes.default_contact_id = updates.default_contact_id');
  });

  it('T033/T034/T035: NinjaOne mappings expose and persist default_contact_id without bypassing permissions', () => {
    const source = readRepoFile('ee/server/src/lib/actions/integrations/ninjaoneActions.ts');

    expect(source).toContain('export const getNinjaOneOrganizationMappings = withAdvancedAssetsAccess');
    expect(source).toContain("'rom.*'");
    expect(source).toContain("const canView = await hasPermission(user, 'settings', 'read')");
    expect(source).toContain("const canUpdate = await hasPermission(user, 'settings', 'update')");
    expect(source).toContain('default_contact_id?: string | null');
    expect(source).toContain("if ('default_contact_id' in updates)");
    expect(source).toContain('dbUpdates.default_contact_id = updates.default_contact_id');
  });
});
