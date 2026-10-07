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
});
