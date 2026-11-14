import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const released = vi.hoisted(() => vi.fn<(tenant: string) => Promise<boolean>>());
const readWork = vi.hoisted(() => vi.fn());
const reevaluateSlaPause = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../seatRelease', () => ({ coManagedSeatReleased: released }));
vi.mock('../seatTicketHandoff', () => ({ readCoManagedSeatTicketWork: readWork }));
vi.mock('@alga-psa/shared/lib/sla/slaPauseConditions', () => ({ reevaluateSlaPause, registerSlaPauseCondition: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ registerSeatResponsibilityObserver: vi.fn() }));

import { clientItResponsibilityPauseCondition, onSeatResponsibility } from '../seatTicketSla';

const trx = {} as Knex.Transaction;
const event = { kind: 'seatResponsibility' as const, tenant: 'tenant', ticketId: 'ticket', arrangementId: 'arr',
  from: 'msp' as const, to: 'client_it' as const, operationId: 'op', occurredAt: new Date().toISOString(), actorUserId: 'actor' };

describe('seat responsibility SLA pause condition', () => {
  beforeEach(() => { vi.clearAllMocks(); released.mockResolvedValue(true); });

  it('returns without querying when the seat shape is not released for the tenant', async () => {
    released.mockResolvedValue(false);
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBeNull();
    expect(readWork).not.toHaveBeenCalled();
  });

  it('holds only while client IT is responsible under a live arrangement', async () => {
    readWork.mockResolvedValueOnce({ arrangementId: 'a', responsibility: 'client_it', revision: 1 });
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBe('client_it_responsibility');
    readWork.mockResolvedValueOnce({ arrangementId: 'a', responsibility: 'msp', revision: 2 });
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBeNull();
    // A client with no live arrangement has no responsibility at all.
    readWork.mockResolvedValueOnce(null);
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBeNull();
  });
});

describe('seat responsibility lifecycle handler', () => {
  beforeEach(() => { vi.clearAllMocks(); released.mockResolvedValue(true); });

  it('does nothing when the seat shape is not released: no SLA re-evaluation', async () => {
    released.mockResolvedValue(false);
    await onSeatResponsibility(trx, event);
    expect(reevaluateSlaPause).not.toHaveBeenCalled();
  });

  it('asks the SLA pause port to re-evaluate the ticket inside the handoff transaction', async () => {
    await onSeatResponsibility(trx, event);
    expect(reevaluateSlaPause).toHaveBeenCalledWith(trx, 'tenant', 'ticket', 'actor');
  });

  it('throws when the re-evaluation failed, so the handoff rolls back with its clock fact', async () => {
    reevaluateSlaPause.mockRejectedValueOnce(new Error('boom'));
    await expect(onSeatResponsibility(trx, event)).rejects.toThrow(/boom/);
  });
});

// @alga-psa/sla depends on @alga-psa/notifications, which imports this package. Any edge from here
// to the SLA package (declared or imported, static or dynamic) closes an Nx build-graph cycle and
// stops every `nx run-many -t build` that reaches this package.
describe('co-managed package boundary', () => {
  const root = path.resolve(__dirname, '..', '..');
  const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });

  it('does not declare a dependency on @alga-psa/sla', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    expect(Object.keys(declared)).not.toContain('@alga-psa/sla');
  });

  it('does not import @alga-psa/sla from any source or test file', () => {
    const importsSla = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@alga-psa\/sla(?:\/[^'"]*)?['"]/;
    const offenders = sources(path.join(root, 'src')).filter((file) => importsSla.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
});
