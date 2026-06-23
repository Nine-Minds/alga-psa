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

  it('T044: Tactical/Level/Tanium mapping actions select and persist default_contact_id', () => {
    const tactical = readRepoFile('packages/integrations/src/actions/integrations/tacticalRmmActions.ts');
    const level = readRepoFile('ee/server/src/lib/actions/integrations/levelIoActions.ts');
    const tanium = readRepoFile('ee/server/src/lib/actions/integrations/taniumActions.ts');

    // Each provider's list query selects the column, and its update accepts the
    // camelCase input mapped to the snake_case patch (set + clear-to-null).
    for (const source of [tactical, level, tanium]) {
      expect(source).toContain('default_contact_id');
      expect(source).toContain('defaultContactId?: string | null');
      expect(source).toContain('patch.default_contact_id = input.defaultContactId || null');
    }
    // Tactical/Level surface it via the joined select alias; Tanium also lists it
    // in its reconciliation select array.
    expect(tactical).toContain("'rom.default_contact_id'");
    expect(level).toContain("'rom.default_contact_id'");
    expect(tanium).toContain("'rom.default_contact_id'");
  });

  it('T043: deleting a contact unlinks it from any RMM mapping default (backend, not a DB FK)', () => {
    const source = readRepoFile('packages/clients/src/actions/contact-actions/contactActions.tsx');

    expect(source).toContain("trx('rmm_organization_mappings')");
    expect(source).toContain('.where({ default_contact_id: contactId, tenant: tenantId })');
    expect(source).toContain('.update({ default_contact_id: null })');
  });
});
