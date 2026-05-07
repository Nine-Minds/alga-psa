import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

function read(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

describe('Algadesk client/contact composition contracts', () => {
  it('preserves client CRUD and support context while filtering excluded client surfaces', () => {
    const source = read('../packages/clients/src/components/clients/ClientDetails.tsx');

    expect(source).toContain('updateClient(');
    expect(source).toContain('deleteClient(');
    expect(source).toContain('id={`${id}-delete-client-button`}');
    expect(source).toContain('renderClientTickets({');
    expect(source).toContain('ClientLocations');
    expect(source).toContain("'projects'");
    expect(source).toContain("'service-catalog'");
    expect(source).toContain("'services'");
    expect(source).toContain('const shouldRenderPsaOnlyClientSurfaces = !isAlgadeskMode;');
    expect(source).toContain('shouldRenderPsaOnlyClientSurfaces ? renderClientAssets');
  });

  it('preserves contact CRUD, ticket context, phone/email management, and notes', () => {
    const source = read('../packages/clients/src/components/contacts/ContactDetails.tsx');

    expect(source).toContain('updateContact(dataToUpdate)');
    expect(source).toContain('deleteContact(');
    expect(source).toContain('renderContactTickets({');
    expect(source).toContain('<ContactPhoneNumbersEditor');
    expect(source).toContain('<ContactEmailAddressesEditor');
    expect(source).toContain('<ContactNotesPanel');
  });

  it('runs Algadesk contact detail page in product-safe mode', () => {
    const source = read('src/app/msp/contacts/[id]/page.tsx');

    expect(source).toContain("const isAlgadesk = (await getCurrentTenantProduct()) === 'algadesk';");
    expect(source).toContain('if (!isAlgadesk && tab === \'documents\')');
    expect(source).toContain('isAlgadeskMode={isAlgadesk}');
  });
});
