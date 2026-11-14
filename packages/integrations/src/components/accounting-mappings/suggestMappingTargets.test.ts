import { describe, expect, it } from 'vitest';

import { normalizeMappingName, suggestMappingTargets } from './suggestMappingTargets';
import type { AccountingMappingEntityOption as Opt } from './types';

const item = (code: string, baseName: string): Opt => ({
  id: `item:${code}`,
  name: `Item · ${baseName} (${code})`,
  kind: 'item',
  code,
  baseName,
});
const account = (code: string, baseName: string): Opt => ({
  id: `account:${code}`,
  name: `Revenue account · ${baseName} (${code})`,
  kind: 'account',
  code,
  baseName,
});
const svc = (id: string, baseName: string, sku?: string): Opt => ({
  id,
  name: `${baseName}${sku ? ` (${sku})` : ''}`,
  baseName,
  code: sku,
});

describe('normalizeMappingName', () => {
  it('folds case, whitespace and punctuation', () => {
    expect(normalizeMappingName('  Managed   Backup — Pro! ')).toBe('managed backup pro');
  });
});

describe('suggestMappingTargets', () => {
  it('exact code wins over a name match on another target', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Consulting', 'CONSULT-1')],
      [item('OTHER', 'Consulting'), item('consult-1', 'Something else entirely')]
    );
    expect(result.get('s1')).toEqual({ externalId: 'item:consult-1', kind: 'item', matchedBy: 'code' });
  });

  it('matches by name after normalising decoration and punctuation', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Remote  Support')],
      [item('RS', 'remote support')]
    );
    expect(result.get('s1')?.externalId).toBe('item:RS');
    expect(result.get('s1')?.matchedBy).toBe('name');
  });

  it('prefers the item over an account on an equal exact name, keeping kinds distinct', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Hosting')],
      [account('200', 'Hosting'), item('200', 'Hosting')]
    );
    expect(result.get('s1')).toMatchObject({ externalId: 'item:200', kind: 'item' });
  });

  it('suggests an account only from an exact match, and carries its kind', () => {
    const result = suggestMappingTargets([svc('s1', 'Sales')], [account('200', 'Sales')]);
    expect(result.get('s1')).toEqual({ externalId: 'account:200', kind: 'account', matchedBy: 'name' });
  });

  it('never suggests an account from a code match: SKU 200 does not pick account:200', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Consulting', '200')],
      [account('200', 'Sales')]
    );
    expect(result.has('s1')).toBe(false);
  });

  it('a SKU equal to both an item code and an account code picks the item', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Consulting', '200')],
      [account('200', 'Sales'), item('200', 'Unrelated Name')]
    );
    expect(result.get('s1')).toEqual({ externalId: 'item:200', kind: 'item', matchedBy: 'code' });
  });

  it('an account is still suggested on an exact name even when its code equals the SKU', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Sales', '200')],
      [account('200', 'Sales')]
    );
    expect(result.get('s1')).toMatchObject({ externalId: 'account:200', matchedBy: 'name' });
  });

  it('labels near-miss variants as fuzzy so callers can avoid preselecting them', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Managed Backup Service Plan', 'MB')],
      [item('MBA', 'Managed Backup Service Plan Annual')]
    );
    expect(result.get('s1')?.matchedBy).toBe('fuzzy');
  });

  it('never suggests an account from a fuzzy match', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Managed Backup Service Plan')],
      [account('200', 'Managed Backup Service Plan Revenue')]
    );
    expect(result.has('s1')).toBe(false);
  });

  it('suggests a conservative fuzzy item match', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Managed Backup Service Plan')],
      [item('MB', 'Managed Backup Service Plan Annual')]
    );
    expect(result.get('s1')).toMatchObject({ externalId: 'item:MB', matchedBy: 'fuzzy' });
  });

  it('skips ambiguous matches instead of guessing', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Managed Backup Service Plan')],
      [item('A', 'Managed Backup Service Plan Annual'), item('B', 'Managed Backup Service Plan Monthly')]
    );
    expect(result.has('s1')).toBe(false);
  });

  it('maps an M365-style family one SKU to one item, not all to one', () => {
    const algas = [
      svc('s1', 'Microsoft 365 Business Basic', 'M365-BASIC'),
      svc('s2', 'Microsoft 365 Business Standard', 'M365-STD'),
      svc('s3', 'Microsoft 365 Business Premium'),
      svc('s4', 'Microsoft 365 E3'),
    ];
    const externals = [
      item('M365-BASIC', 'M365 Basic'),
      item('M365-STD', 'M365 Standard'),
      item('X3', 'Microsoft 365 Business Premium'),
      item('E3', 'Microsoft 365 E5'),
    ];
    const result = suggestMappingTargets(algas, externals);
    expect(result.get('s1')?.externalId).toBe('item:M365-BASIC');
    expect(result.get('s2')?.externalId).toBe('item:M365-STD');
    expect(result.get('s3')?.externalId).toBe('item:X3');
    // Close-but-different tiers (E3 vs E5) are not guessed.
    expect(result.has('s4')).toBe(false);
  });

  it('works for kind-less modules (QBO)', () => {
    const result = suggestMappingTargets(
      [svc('s1', 'Consulting')],
      [{ id: '42', name: 'Consulting', baseName: 'Consulting' }]
    );
    expect(result.get('s1')).toEqual({ externalId: '42', kind: undefined, matchedBy: 'name' });
  });

  it('does not preselect the same exact target for more than one row', () => {
    const result = suggestMappingTargets(
      [svc('a', 'Power BI Pro'), svc('b', 'Power BI Pro'), svc('c', 'Hosting')],
      [item('PBI', 'Power BI Pro'), item('HOST', 'Hosting')]
    );
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(false);
    expect(result.get('c')).toMatchObject({ externalId: 'item:HOST' });
  });

  describe('unavailable targets', () => {
    const taken = (...ids: string[]) => ({ unavailableExternalIds: new Set(ids) });

    it('blocks a twin whose exact name match is taken, with no fuzzy fallback', () => {
      const result = suggestMappingTargets(
        [svc('b', 'Power BI Pro')],
        [item('PBI', 'Power BI Pro'), item('PBIA', 'Power BI Pro Annual')],
        taken('item:PBI')
      );
      expect(result.has('b')).toBe(false);
    });

    it('a blocked code tier skips the name tier', () => {
      const result = suggestMappingTargets(
        [svc('s1', 'Consulting', 'CONSULT-1')],
        [item('CONSULT-1', 'Unrelated'), item('FREE', 'Consulting')],
        taken('item:CONSULT-1')
      );
      expect(result.has('s1')).toBe(false);
    });

    it('suggests the free item when twin catalog items exist and one is taken', () => {
      const result = suggestMappingTargets(
        [svc('b', 'Power BI Pro')],
        [item('PBI1', 'Power BI Pro'), item('PBI2', 'Power BI Pro')],
        taken('item:PBI1')
      );
      expect(result.get('b')).toEqual({ externalId: 'item:PBI2', kind: 'item', matchedBy: 'name' });
    });

    it('does not fall back to a free account when the preferred-kind item is taken', () => {
      const result = suggestMappingTargets(
        [svc('s1', 'Sales')],
        [item('S1', 'Sales'), account('200', 'Sales')],
        taken('item:S1')
      );
      expect(result.has('s1')).toBe(false);
    });

    it('a held account:200 does not block an item:200 suggestion', () => {
      const result = suggestMappingTargets(
        [svc('s1', 'Hosting Plan')],
        [item('200', 'Hosting Plan'), account('200', 'Sales')],
        taken('account:200')
      );
      expect(result.get('s1')).toMatchObject({ externalId: 'item:200', kind: 'item' });
    });

    it('never fuzzy-suggests an unavailable target', () => {
      const algas = [svc('s1', 'Power BI Pro Annual')];
      const externals = [item('PBIP', 'Power BI Pro Annual Plan')];
      expect(suggestMappingTargets(algas, externals).get('s1')).toMatchObject({ matchedBy: 'fuzzy' });
      expect(suggestMappingTargets(algas, externals, taken('item:PBIP')).has('s1')).toBe(false);
    });

    it('keeps an exact match ambiguous when several available candidates remain', () => {
      const result = suggestMappingTargets(
        [svc('s1', 'Power BI Pro Annual')],
        [item('A', 'Power BI Pro Annual'), item('B', 'Power BI Pro Annual'), item('C', 'Power BI Pro Annual'), item('D', 'Power BI Pro Annual Plan')],
        taken('item:C')
      );
      expect(result.has('s1')).toBe(false);
    });

    it('behaves as before when unavailableExternalIds is omitted', () => {
      const result = suggestMappingTargets([svc('b', 'Power BI Pro')], [item('PBI', 'Power BI Pro')]);
      expect(result.get('b')).toMatchObject({ externalId: 'item:PBI' });
    });
  });

  describe('shareable vs exclusive targets', () => {
    const shareable = (option: Opt) => option.kind === 'account';
    const exclusiveUnlessAccount = (option: Opt) => !shareable(option);

    it('keeps an exact suggestion for every row when the target is shareable', () => {
      const algas = [svc('s1', 'Managed Services'), svc('s2', 'Managed Services')];
      const externals = [item('MS', 'Managed Services')];
      const result = suggestMappingTargets(algas, externals, { isExclusiveTarget: () => false });
      expect(result.get('s1')).toMatchObject({ externalId: 'item:MS', matchedBy: 'name' });
      expect(result.get('s2')).toMatchObject({ externalId: 'item:MS', matchedBy: 'name' });
    });

    it('treats a duplicate exact claim on an exclusive target as ambiguous, in either input order', () => {
      const algas = [svc('s1', 'Managed Services'), svc('s2', 'Managed Services')];
      const externals = [item('MS', 'Managed Services')];
      const forward = suggestMappingTargets(algas, externals, { isExclusiveTarget: () => true });
      const reversed = suggestMappingTargets([...algas].reverse(), [...externals].reverse(), {
        isExclusiveTarget: () => true,
      });
      expect([...forward.keys()]).toEqual([]);
      expect([...reversed.keys()]).toEqual([]);
    });

    it('defaults to exclusive when no callback is supplied', () => {
      const result = suggestMappingTargets(
        [svc('s1', 'Managed Services'), svc('s2', 'Managed Services')],
        [item('MS', 'Managed Services')]
      );
      expect(result.size).toBe(0);
    });

    it('decides per target kind: shared account suggested twice, exclusive item not', () => {
      const algas = [svc('s1', 'Hosting'), svc('s2', 'Hosting')];
      const sharedOnly = suggestMappingTargets(algas, [account('200', 'Hosting')], {
        isExclusiveTarget: exclusiveUnlessAccount,
      });
      expect([...sharedOnly.keys()].sort()).toEqual(['s1', 's2']);
      const itemOnly = suggestMappingTargets(algas, [item('200', 'Hosting')], {
        isExclusiveTarget: exclusiveUnlessAccount,
      });
      expect(itemOnly.size).toBe(0);
    });

    it('does not remove a shareable exact claim from the fuzzy pool, but does remove an exclusive one', () => {
      const algas = [svc('s1', 'Power BI Pro Annual'), svc('s2', 'Power BI Pro Annual Plan')];
      const externals = [item('PBI', 'Power BI Pro Annual')];
      const shared = suggestMappingTargets(algas, externals, { isExclusiveTarget: () => false });
      expect(shared.get('s1')).toMatchObject({ matchedBy: 'name', externalId: 'item:PBI' });
      expect(shared.get('s2')).toMatchObject({ matchedBy: 'fuzzy', externalId: 'item:PBI' });
      const exclusive = suggestMappingTargets(algas, externals, { isExclusiveTarget: () => true });
      expect(exclusive.get('s1')).toMatchObject({ externalId: 'item:PBI' });
      expect(exclusive.has('s2')).toBe(false);
    });

    it('gives identical results regardless of input order for shareable targets', () => {
      const algas = [svc('s1', 'Consulting'), svc('s2', 'Consulting'), svc('s3', 'Backup Plan Pro')];
      const externals = [item('C', 'Consulting'), item('B', 'Backup Plan Pro')];
      const opts = { isExclusiveTarget: () => false };
      const a = suggestMappingTargets(algas, externals, opts);
      const b = suggestMappingTargets([...algas].reverse(), [...externals].reverse(), opts);
      const dump = (m: Map<string, unknown>) => JSON.stringify([...m.entries()].sort());
      expect(dump(a)).toBe(dump(b));
      expect(a.size).toBe(3);
    });
  });
});
