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
});
