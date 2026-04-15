import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContactModel } from '../contactModel';

type FakeQuery = {
  where: (..._args: any[]) => FakeQuery;
  first: () => Promise<any>;
  select: (..._args: any[]) => FakeQuery;
};

function makeQuery(firstRow: any): FakeQuery {
  return {
    where: () => makeQuery(firstRow),
    first: async () => firstRow,
    select: () => makeQuery(firstRow),
  };
}

function makeTrx(config: {
  contactRow?: any;
  additionalEmailRow?: any;
}) {
  return ((table: string) => {
    if (table === 'contacts') {
      return makeQuery(config.contactRow);
    }

    if (table === 'contact_additional_email_addresses') {
      return makeQuery(config.additionalEmailRow);
    }

    throw new Error(`Unexpected table ${table}`);
  }) as any;
}

describe('ContactModel.getContactByEmail', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T031: resolves a contact when only an additional email row matches the lookup email', async () => {
    const expectedContact = {
      contact_name_id: 'contact-1',
      email: 'owner@acme.com',
    };

    const getContactByIdSpy = vi
      .spyOn(ContactModel, 'getContactById')
      .mockResolvedValue(expectedContact as any);

    const trx = makeTrx({
      contactRow: undefined,
      additionalEmailRow: { contact_name_id: 'contact-1' },
    });

    const contact = await ContactModel.getContactByEmail('billing@acme.com', 'tenant-1', trx);

    expect(getContactByIdSpy).toHaveBeenCalledWith('contact-1', 'tenant-1', trx);
    expect(contact).toEqual(expectedContact);
  });
});
