import { describe, expect, it } from 'vitest';
import knexFactory from 'knex';
import type { BundleNarrowingRule } from '@alga-psa/authorization';
import { applyCoManagedQueuePolicy } from '../queuePolicy';

// S6: co-managed queue/project/management policies pass the subject's full rule set, so a closed bundle that does
// not name the resource/action denies here exactly as it does in the kernel.
const db = knexFactory({ client: 'pg' });
const subject = { tenant: 't1', userId: 'u1', userType: 'internal' as const, roleIds: [], teamIds: [], managedUserIds: [] };
const rule = (id: string, bundleId: string, baseline: 'open' | 'closed', resource: string, action: string,
  extra: Partial<BundleNarrowingRule> = {}): BundleNarrowingRule =>
  ({ id, bundleId, revisionId: `${bundleId}-rev`, baseline, resource, action, templateKey: null, ...extra });

const compile = (rules: BundleNarrowingRule[], resourceType = 'ticket') => {
  const q = db.from('x as q');
  applyCoManagedQueuePolicy(q, subject, rules, { resourceType, shared: true });
  return q.toSQL().sql;
};

describe('co-managed queue policy honours the closed baseline', () => {
  it('denies when a closed bundle does not name ticket:read (its rules are about another resource)', () => {
    expect(compile([rule('c', 'closed', 'closed', 'project', 'read')])).toContain('1 = 0');
  });

  it('allows when the closed bundle names ticket:read', () => {
    expect(compile([rule('c', 'closed', 'closed', 'ticket', 'read')])).not.toContain('1 = 0');
  });

  it('an open bundle about another resource leaves the queue unrestricted', () => {
    expect(compile([rule('o', 'open', 'open', 'project', 'read')])).not.toContain('1 = 0');
  });

  it('constraints come only from rules matching the resource and action', () => {
    const constraint = { field: 'client_id', operator: 'eq', value: '00000000-0000-4000-8000-000000000001' } as const;
    const other = compile([rule('o', 'open', 'open', 'project', 'read', { constraints: [constraint] as any })]);
    expect(other).not.toContain('"q"."auth_client" = ?');
    const matching = compile([rule('o', 'open', 'open', 'ticket', 'read', { constraints: [constraint] as any })]);
    expect(matching).toContain('"q"."auth_client" = ?');
  });
});
