import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const released = vi.hoisted(() => vi.fn<(tenant: string) => Promise<boolean>>());
const authority = vi.hoisted(() => vi.fn());
vi.mock('../seatRelease', () => ({ coManagedSeatReleased: released }));
vi.mock('../seatAuthority', () => ({ coManagedSeatAuthority: authority }));

import { coManagedSeatListResponsibilityProvider as provider } from '../seatTicketListResponsibility';

const subject = { resolverFacts: {} } as never;

describe('MSP ticket list responsibility column and filter gating', () => {
  beforeEach(() => { vi.clearAllMocks(); released.mockResolvedValue(true); authority.mockReturnValue(null); });

  it('is offered to MSP staff while the seat shape is released', async () => {
    await expect(provider.offered({ tenant: 't', subject })).resolves.toBe(true);
  });

  it('is not offered when the flag or capability is off: the release verdict is asked, nothing else', async () => {
    released.mockResolvedValue(false);
    await expect(provider.offered({ tenant: 't', subject })).resolves.toBe(false);
  });

  it('is not offered to a seat technician, who has views instead, and the gate is not even asked', async () => {
    authority.mockReturnValue({ scope: {} });
    await expect(provider.offered({ tenant: 't', subject })).resolves.toBe(false);
    expect(released).not.toHaveBeenCalled();
  });

  it('reads nothing for an empty page', async () => {
    const trx = { raw: vi.fn() } as unknown as Knex.Transaction;
    expect((await provider.read(trx, 't', [])).size).toBe(0);
    expect(trx.raw).not.toHaveBeenCalled();
  });

  it('reads a page in one statement from the seat_responsibility predicate, blank for tickets that have none', async () => {
    const raw = vi.fn(async () => ({ rows: [
      { ticket_id: 'a', responsibility: 'client_it' }, { ticket_id: 'b', responsibility: 'msp' }, { ticket_id: 'c', responsibility: null },
    ] }));
    const result = await provider.read({ raw } as unknown as Knex.Transaction, 't', ['a', 'b', 'c']);
    expect(raw).toHaveBeenCalledTimes(1);
    const sql = (raw.mock.calls[0] as unknown as [string])[0];
    expect(sql).toContain('co_managed_seat_ticket_work');
    expect(sql).toContain('co_managed_seat_arrangements');
    expect([...result]).toEqual([['a', 'client_it'], ['b', 'msp']]);
  });
});
