import { describe, expect, it, vi } from 'vitest';
import { id, resolveModules, type FixtureModule } from './shared';
import { parseArgs, parseEnvFile, REGISTRY, run } from './index';
import { DISPOSABLE_CLIENTS, L1A_CAPACITY, l1aModule } from './L1a';
import { l9Module } from './L9';
import { notificationModule, NOTIFICATION_CUSTOMER, NOTIFICATION_USERS } from './notification';

const mod = (name: string, requires: string[] = []): FixtureModule => ({
  name, requires, apply: vi.fn(async () => {}), verify: vi.fn(async () => []), reset: vi.fn(async () => {}),
});

describe('co-managed fixtures', () => {
  it('resolves dependencies first and each module once', () => {
    const [a, b, c] = [mod('base'), mod('L1a', ['base']), mod('L2', ['L1a', 'base'])];
    expect(resolveModules([c, b, a], 'L2').map(m => m.name)).toEqual(['base', 'L1a', 'L2']);
    expect(() => resolveModules([a], 'nope')).toThrow(/Unknown/);
    expect(() => resolveModules([mod('x', ['y']), mod('y', ['x'])], 'x')).toThrow(/cycle/);
  });

  it('L1a requires base and derives stable ids from slugs', () => {
    expect(l1aModule.requires).toEqual(['base']);
    expect(REGISTRY.map(m => m.name)).toEqual(['base', 'L1a', 'notification', 'L9']);
    expect(DISPOSABLE_CLIENTS.map(c => c.clientId)).toEqual([id('client/oz/disposable-enable'), id('client/oz/disposable-cancel')]);
    expect(id('x')).toBe(id('x'));
  });

  it('L9 declares its L1a parent and resolves after it', () => {
    expect(l9Module.requires).toEqual(['L1a']);
    expect(resolveModules(REGISTRY, 'L9').map(m => m.name)).toEqual(['base', 'L1a', 'L9']);
  });

  it('notification layer owns distinct stable customer, sponsor identities, and per-recipient policies', () => {
    expect(notificationModule.requires).toEqual(['base']);
    expect(resolveModules(REGISTRY, 'notification').map(m => m.name)).toEqual(['base', 'notification']);
    expect(NOTIFICATION_CUSTOMER).toBe(id('tenant/notification-customer'));
    expect(NOTIFICATION_USERS.map(user => user.userId)).toEqual([
      id('user/oz/notification-redacted'), id('user/oz/notification-visible'),
    ]);
    expect(NOTIFICATION_USERS[0].hidden).toContain('tickets.title');
    expect(NOTIFICATION_USERS[1].hidden).toEqual([]);
  });

  it('applies in order inside one transaction and resets in reverse', async () => {
    const order: string[] = [];
    const [a, b] = [mod('base'), mod('L1a', ['base'])];
    a.apply = vi.fn(async () => { order.push('apply base'); });
    b.apply = vi.fn(async () => { order.push('apply L1a'); });
    a.reset = vi.fn(async () => { order.push('reset base'); });
    b.reset = vi.fn(async () => { order.push('reset L1a'); });
    const db: any = { transaction: async (work: (t: unknown) => Promise<void>) => work({}) };
    const engines = vi.fn(async () => ({}) as never);
    await run(db, { through: 'L1a', mode: 'apply' }, engines, [a, b]);
    await run(db, { through: 'L1a', mode: 'reset' }, engines, [a, b]);
    expect(order).toEqual(['apply base', 'apply L1a', 'reset L1a', 'reset base']);
    expect(engines).toHaveBeenCalledTimes(1);
  });

  it('applies only the requested layer after checking its prerequisites', async () => {
    const order: string[] = [];
    const base = mod('base'), target = mod('notification', ['base']), unrelated = mod('other');
    base.verify = vi.fn(async () => { order.push('verify base'); return [{ ok: true, area: 'base', detail: 'ready' }]; });
    base.apply = vi.fn(async () => { order.push('apply base'); });
    target.apply = vi.fn(async () => { order.push('apply notification'); });
    unrelated.apply = vi.fn(async () => { order.push('apply other'); });
    const db: any = { transaction: async (work: (t: unknown) => Promise<void>) => work({}) };
    await run(db, { through: 'other', only: 'notification', mode: 'apply' }, async () => ({}) as never, [base, target, unrelated]);
    expect(order).toEqual(['verify base', 'apply notification']);
  });

  it('verify fails when a module reports a mismatch and never loads engines', async () => {
    const m = mod('base');
    m.verify = vi.fn(async () => [{ ok: false, area: 'base', detail: 'bad' }]);
    const engines = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await run({} as never, { through: 'base', mode: 'verify' }, engines as never, [m])).toBe(false);
    expect(engines).not.toHaveBeenCalled();
  });

  it('L1a verify asserts one unsigned grant, no live disposable setup, no stray co_managed tenant', async () => {
    const results: Record<string, unknown> = {
      co_managed_entitlements: [{ source: 'admin_grant', source_reference: 'fixture:l1a', capacity: L1A_CAPACITY, signed_license: null }],
    };
    const chain = (rows: unknown): any => {
      const c: any = new Proxy(function () {}, {
        get: (_t, prop) => prop === 'then' ? (res: (v: unknown) => void) => res(rows) : () => c,
      });
      return c;
    };
    const db: any = (table: string) => chain(
      table === 'co_managed_entitlements' ? results[table] : table === 'tenants' ? [] : [{ count: '0' }]);
    const reports = await l1aModule.verify(db);
    expect(reports.every(r => r.ok)).toBe(true);
    results.co_managed_entitlements = [...(results.co_managed_entitlements as unknown[]), {}];
    expect((await l1aModule.verify(db)).some(r => !r.ok)).toBe(true);
  });

  it('parses env files without a shell and CLI flags', () => {
    expect(parseEnvFile('A=1\n# c\nB="x&y"\n')).toEqual({ A: '1', B: 'x&y' });
    expect(parseArgs(['--through', 'base', '--verify'])).toEqual({ through: 'base', mode: 'verify' });
    expect(parseArgs(['--only', 'notification'])).toEqual({ through: 'L9', only: 'notification', mode: 'apply' });
    expect(parseArgs([])).toEqual({ through: 'L9', mode: 'apply' });
  });
});
