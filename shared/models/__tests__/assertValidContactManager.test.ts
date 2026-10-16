import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { contact_name_id: string; client_id: string | null; contact_kind?: string; manager_contact_id?: string | null };
let contacts: Row[] = [];

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (_name: string) => {
      let id: string | undefined;
      const builder: any = {
        where: (criteria: { contact_name_id: string }) => {
          id = criteria.contact_name_id;
          return builder;
        },
        first: async () => contacts.find((row) => row.contact_name_id === id),
      };
      return builder;
    },
  }),
}));

import { assertValidContactManager } from '../contactModel';

const db = {} as any;
const call = (input: { contactId?: string | null; clientId: string | null; managerContactId: string }) =>
  assertValidContactManager(db, 'tenant-1', input);

describe('assertValidContactManager', () => {
  beforeEach(() => {
    contacts = [
      { contact_name_id: 'ceo', client_id: 'acme', contact_kind: 'person', manager_contact_id: null },
      { contact_name_id: 'vp', client_id: 'acme', contact_kind: 'person', manager_contact_id: 'ceo' },
      { contact_name_id: 'dev', client_id: 'acme', contact_kind: 'person', manager_contact_id: 'vp' },
      { contact_name_id: 'outsider', client_id: 'globex', contact_kind: 'person', manager_contact_id: null },
      { contact_name_id: 'inbox', client_id: 'acme', contact_kind: 'shared_mailbox', manager_contact_id: null },
    ];
  });

  it('accepts a same-client person, including as a new contact\'s manager', async () => {
    await expect(call({ contactId: 'dev', clientId: 'acme', managerContactId: 'ceo' })).resolves.toBeUndefined();
    await expect(call({ clientId: 'acme', managerContactId: 'dev' })).resolves.toBeUndefined();
  });

  it('rejects a manager from another client', async () => {
    await expect(call({ contactId: 'dev', clientId: 'acme', managerContactId: 'outsider' }))
      .rejects.toThrow(/VALIDATION_ERROR: .*same client/);
  });

  it('rejects the contact as their own manager', async () => {
    await expect(call({ contactId: 'dev', clientId: 'acme', managerContactId: 'dev' }))
      .rejects.toThrow(/own manager/);
  });

  it('rejects a shared mailbox as manager', async () => {
    await expect(call({ contactId: 'dev', clientId: 'acme', managerContactId: 'inbox' }))
      .rejects.toThrow(/shared mailbox/);
  });

  it('rejects a missing manager', async () => {
    await expect(call({ contactId: 'dev', clientId: 'acme', managerContactId: 'ghost' }))
      .rejects.toThrow(/FOREIGN_KEY_ERROR/);
  });

  it('rejects direct and transitive cycles', async () => {
    // ceo -> dev would close ceo <- vp <- dev <- ceo
    await expect(call({ contactId: 'ceo', clientId: 'acme', managerContactId: 'dev' }))
      .rejects.toThrow(/reporting loop/);
    await expect(call({ contactId: 'vp', clientId: 'acme', managerContactId: 'dev' }))
      .rejects.toThrow(/reporting loop/);
  });

  it('does not loop forever on a pre-existing cycle that excludes the contact', async () => {
    contacts.push(
      { contact_name_id: 'a', client_id: 'acme', manager_contact_id: 'b' },
      { contact_name_id: 'b', client_id: 'acme', manager_contact_id: 'a' },
      { contact_name_id: 'new', client_id: 'acme', manager_contact_id: null },
    );
    await expect(call({ contactId: 'new', clientId: 'acme', managerContactId: 'a' })).resolves.toBeUndefined();
  });

  it('needs a client: a contact without one cannot have a manager', async () => {
    await expect(call({ contactId: 'dev', clientId: null, managerContactId: 'ceo' }))
      .rejects.toThrow(/belong to a client/);
  });
});
