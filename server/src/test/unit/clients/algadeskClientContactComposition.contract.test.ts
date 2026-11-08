import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

function read(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

describe('AlgaDesk client/contact composition contracts', () => {
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
    expect(source).toContain('const shouldRenderPsaOnlyClientSurfaces = !isAlgaDeskMode;');
    expect(source).toContain('shouldRenderPsaOnlyClientSurfaces ? renderClientAssets');
  });

  it('preserves contact CRUD, ticket context, phone/email management, and notes', () => {
    // ContactDetails.tsx was never rendered and has been deleted; the live surfaces carry these.
    const edit = read('../packages/clients/src/components/contacts/ContactDetailsEdit.tsx');
    const list = read('../packages/clients/src/components/contacts/Contacts.tsx');
    const bento = read('../packages/clients/src/components/contacts/bento/ContactBentoLayout.tsx');
    const crossFeature = read('../packages/clients/src/context/ClientCrossFeatureContext.tsx');

    expect(edit).toContain('await updateContact({');
    expect(list).toContain('deleteContact(');
    expect(crossFeature).toContain('renderContactTickets: (props: ContactTicketsRenderProps) => ReactNode;');
    expect(edit).toContain('<ContactPhoneNumbersEditor');
    expect(edit).toContain('<ContactEmailAddressesEditor');
    expect(bento).toContain("saveField('notes'");
  });

  it('runs AlgaDesk contact detail page in product-safe mode', () => {
    const source = read('src/app/msp/contacts/[id]/page.tsx');

    expect(source).toContain("const isAlgaDesk = (await getCurrentTenantProduct()) === 'algadesk';");
    expect(source).toContain('isAlgaDesk ? Promise.resolve([]) : settledValue(getDocumentsByEntity(');
    expect(source).toContain('showDocuments={!isAlgaDesk}');
  });
});
