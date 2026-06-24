import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('RMM default contact mapping UI contracts', () => {
  const huntress = () =>
    readRepoFile('ee/server/src/components/settings/integrations/huntress/OrganizationMappingManager.tsx');
  const ninjaone = () =>
    readRepoFile('ee/server/src/components/settings/integrations/ninjaone/OrganizationMappingManager.tsx');

  it('T036/T038/T039/T040/T041/T042: Huntress manager renders a filtered default contact picker', () => {
    const source = huntress();

    expect(source).toContain("import { ContactPicker } from '@alga-psa/ui/components/ContactPicker'");
    expect(source).toContain('getAllContacts');
    expect(source).toContain('const [contacts, setContacts] = useState<IContact[]>([])');
    expect(source).toContain('Default Contact');
    expect(source).toContain('id={`huntress-default-contact-picker-${mapping.mapping_id}`}');
    expect(source).toContain('contacts={contacts}');
    expect(source).toContain("value={mapping.default_contact_id ?? ''}");
    expect(source).toContain('clientId={mapping.client_id ?? undefined}');
    expect(source).toContain('disabled={!mapping.client_id}');
    expect(source).toContain('default_contact_id: contactId || null');
    expect(source).toContain('default_contact_id: null');
  });

  it('T037/T038/T039/T040/T041/T042: NinjaOne manager renders a filtered default contact picker', () => {
    const source = ninjaone();

    expect(source).toContain("import { ContactPicker } from '@alga-psa/ui/components/ContactPicker'");
    expect(source).toContain('getAllContacts');
    expect(source).toContain('const [contacts, setContacts] = useState<IContact[]>([])');
    expect(source).toContain('Default Contact');
    expect(source).toContain('id={`ninjaone-default-contact-picker-${mapping.mapping_id}`}');
    expect(source).toContain('contacts={contacts}');
    expect(source).toContain("value={mapping.default_contact_id ?? ''}");
    expect(source).toContain('clientId={mapping.client_id ?? undefined}');
    expect(source).toContain('disabled={!mapping.client_id || isSaving}');
    expect(source).toContain('default_contact_id: contactId || null');
    expect(source).toContain('default_contact_id: null');
  });

  const tactical = () =>
    readRepoFile('packages/integrations/src/components/settings/integrations/TacticalRmmIntegrationSettings.tsx');
  const level = () =>
    readRepoFile('ee/server/src/components/settings/integrations/LevelIoIntegrationSettings.tsx');
  const tanium = () =>
    readRepoFile('ee/server/src/components/settings/integrations/TaniumIntegrationSettings.tsx');

  it('T045: Tactical/Level/Tanium mapping UIs render a default contact picker, filtered and disabled when unmapped', () => {
    for (const source of [tactical(), level(), tanium()]) {
      expect(source).toContain("import { ContactPicker } from '@alga-psa/ui/components/ContactPicker'");
      expect(source).toContain('default_contact_id');
      // disabled when the row has no mapped client (m. for Tactical, mapping. for Level/Tanium)
      expect(/disabled=\{!(m|mapping)\.client_id\}/.test(source)).toBe(true);
      // filtered to the mapped client
      expect(/clientId=\{(m|mapping)\.client_id \?\? undefined\}/.test(source)).toBe(true);
    }
  });

  it('T046: all five provider pickers wire onAddNew to the Quick Add Contact dialog', () => {
    const all = [
      huntress(),
      ninjaone(),
      tactical(),
      level(),
      tanium(),
    ];
    for (const source of all) {
      expect(source).toContain("import { useQuickAddClient } from '@alga-psa/ui/context'");
      expect(source).toContain('renderQuickAddContact({');
      expect(source).toContain('onAddNew={');
      expect(source).toContain('setQuickAddContactFor({');
    }
  });

  it('T047/T048: Add Alert Rule dialog scrolls and uses the custom Checkbox', () => {
    const source = readRepoFile(
      'packages/integrations/src/components/settings/integrations/RmmAlertAutomationSettings.tsx',
    );

    // T047: the rule editor dialog (max-w-2xl) no longer sets allowOverflow, so
    // its body scrolls. The only remaining allowOverflow is the maintenance
    // window dialog (max-w-xl).
    const overflowCount = (source.match(/allowOverflow/g) ?? []).length;
    expect(overflowCount).toBe(1);
    expect(source).toContain('className="max-w-xl" footer={footer} allowOverflow');
    expect(source).toContain('className="max-w-2xl"');

    // T048: the rule dialog checkbox groups use the custom Checkbox and drop the
    // default mb-4 spacing (severities, organizations, notify-users).
    expect(source).toContain("import { Checkbox } from '@alga-psa/ui/components/Checkbox'");
    const containerOverrides = (source.match(/containerClassName=""/g) ?? []).length;
    expect(containerOverrides).toBeGreaterThanOrEqual(3);
  });
});
