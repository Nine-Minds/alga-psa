import { describe, expect, it } from 'vitest';
import { resolveRmmTicketContactId } from '../resolveContact';

interface State {
  clients: Array<{ tenant: string; client_id: string; properties?: unknown }>;
  contacts: Array<{
    tenant: string;
    client_id: string;
    contact_name_id: string;
    is_inactive?: boolean;
  }>;
}

function makeTrx(state: State) {
  const calls: string[] = [];

  const trx = ((table: keyof State) => {
    calls.push(table);
    let selected: string[] | null = null;
    const filters: Record<string, unknown>[] = [];

    const query = {
      select: (...columns: string[]) => {
        selected = columns;
        return query;
      },
      where: (criteria: Record<string, unknown>) => {
        filters.push(criteria);
        return query;
      },
      first: async () => {
        const row = state[table].find((candidate) =>
          filters.every((criteria) =>
            Object.entries(criteria).every(([key, value]) => candidate[key as keyof typeof candidate] === value),
          ),
        );

        if (!row || !selected) {
          return row;
        }

        return Object.fromEntries(selected.map((column) => [column, row[column as keyof typeof row]]));
      },
    };

    return query;
  }) as any;

  trx.calls = calls;
  trx.state = state;
  return trx;
}

const tenant = 'tenant-1';
const clientId = 'client-1';
const mappingContactId = 'contact-mapping';
const primaryContactId = 'contact-primary';

function baseState(overrides: Partial<State> = {}): State {
  return {
    clients: [{ tenant, client_id: clientId, properties: { primary_contact_id: primaryContactId } }],
    contacts: [
      { tenant, client_id: clientId, contact_name_id: mappingContactId, is_inactive: false },
      { tenant, client_id: clientId, contact_name_id: primaryContactId, is_inactive: false },
    ],
    ...overrides,
  };
}

describe('resolveRmmTicketContactId', () => {
  it('T006/T007: returns the mapping contact when it is active and belongs to the client', async () => {
    const trx = makeTrx(baseState());

    await expect(
      resolveRmmTicketContactId(trx, tenant, {
        clientId,
        mappingDefaultContactId: mappingContactId,
      }),
    ).resolves.toBe(mappingContactId);
    expect(trx.calls).toEqual(['contacts']);
  });

  it('T007/T008: ignores an inactive mapping contact and falls back to the client default', async () => {
    const trx = makeTrx(
      baseState({
        contacts: [
          { tenant, client_id: clientId, contact_name_id: mappingContactId, is_inactive: true },
          { tenant, client_id: clientId, contact_name_id: primaryContactId, is_inactive: false },
        ],
      }),
    );

    await expect(
      resolveRmmTicketContactId(trx, tenant, {
        clientId,
        mappingDefaultContactId: mappingContactId,
      }),
    ).resolves.toBe(primaryContactId);
  });

  it('T008: ignores a mapping contact belonging to a different client and falls back', async () => {
    const trx = makeTrx(
      baseState({
        contacts: [
          { tenant, client_id: 'client-2', contact_name_id: mappingContactId, is_inactive: false },
          { tenant, client_id: clientId, contact_name_id: primaryContactId, is_inactive: false },
        ],
      }),
    );

    await expect(
      resolveRmmTicketContactId(trx, tenant, {
        clientId,
        mappingDefaultContactId: mappingContactId,
      }),
    ).resolves.toBe(primaryContactId);
  });

  it('T009: falls back to clients.properties.primary_contact_id when no mapping contact is set', async () => {
    const trx = makeTrx(baseState());

    await expect(resolveRmmTicketContactId(trx, tenant, { clientId })).resolves.toBe(primaryContactId);
  });

  it('T010: returns null when the fallback primary contact is inactive or cross-client', async () => {
    const inactiveTrx = makeTrx(
      baseState({
        contacts: [{ tenant, client_id: clientId, contact_name_id: primaryContactId, is_inactive: true }],
      }),
    );
    await expect(resolveRmmTicketContactId(inactiveTrx, tenant, { clientId })).resolves.toBeNull();

    const crossClientTrx = makeTrx(
      baseState({
        contacts: [{ tenant, client_id: 'client-2', contact_name_id: primaryContactId, is_inactive: false }],
      }),
    );
    await expect(resolveRmmTicketContactId(crossClientTrx, tenant, { clientId })).resolves.toBeNull();
  });

  it('T011: returns null when neither a mapping contact nor a client primary contact exists', async () => {
    const trx = makeTrx(baseState({ clients: [{ tenant, client_id: clientId, properties: {} }], contacts: [] }));

    await expect(resolveRmmTicketContactId(trx, tenant, { clientId })).resolves.toBeNull();
  });

  it('T012: reads rows available on the passed transaction object', async () => {
    const trx = makeTrx({ clients: [], contacts: [] });

    trx.state.clients.push({ tenant, client_id: clientId, properties: { primary_contact_id: primaryContactId } });
    trx.state.contacts.push({ tenant, client_id: clientId, contact_name_id: primaryContactId, is_inactive: false });

    await expect(resolveRmmTicketContactId(trx, tenant, { clientId })).resolves.toBe(primaryContactId);
    expect(trx.calls).toEqual(['clients', 'contacts']);
  });
});
