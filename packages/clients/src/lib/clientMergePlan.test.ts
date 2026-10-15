import { describe, expect, it } from 'vitest';
import {
  evaluateMergeGuards,
  planBillingProfileMoves,
  planContractMove,
  suggestCutoverDate,
  type MergeClientFacts,
  type MergeableContract,
  type SourceBillingProfile,
} from './clientMergePlan';

const client = (overrides: Partial<MergeClientFacts> = {}): MergeClientFacts => ({
  clientId: 'source-1',
  clientName: 'Acme North',
  mergedIntoClientId: null,
  isTenantDefault: false,
  ...overrides,
});

const profile = (overrides: Partial<SourceBillingProfile> = {}): SourceBillingProfile => ({
  billing_profile_id: 'profile-1',
  name: 'Acme North',
  is_default: true,
  is_system_managed_default: true,
  is_active: true,
  ...overrides,
});

const contract = (overrides: Partial<MergeableContract> = {}): MergeableContract => ({
  clientContractId: 'cc-1',
  contractId: 'contract-1',
  contractName: 'Managed Services',
  startDate: '2026-01-01',
  endDate: null,
  billingProfileId: null,
  isActive: true,
  ...overrides,
});

describe('evaluateMergeGuards', () => {
  it('passes a plain source and target', () => {
    expect(evaluateMergeGuards({
      source: client(),
      target: client({ clientId: 'target-1', clientName: 'Acme Group' }),
      targetAncestorClientIds: [],
    })).toEqual([]);
  });

  it('refuses a missing client without asserting anything else about it', () => {
    const blockers = evaluateMergeGuards({
      source: null,
      target: client({ clientId: 'target-1' }),
      targetAncestorClientIds: [],
    });
    expect(blockers.map((entry) => entry.code)).toEqual(['SOURCE_NOT_FOUND']);
  });

  it('refuses merging a client into itself', () => {
    const blockers = evaluateMergeGuards({
      source: client(),
      target: client(),
      targetAncestorClientIds: [],
    });
    expect(blockers.map((entry) => entry.code)).toContain('SAME_CLIENT');
  });

  it('refuses a source or target that has already been merged', () => {
    expect(evaluateMergeGuards({
      source: client({ mergedIntoClientId: 'somewhere' }),
      target: client({ clientId: 'target-1' }),
      targetAncestorClientIds: [],
    }).map((entry) => entry.code)).toContain('SOURCE_ALREADY_MERGED');

    expect(evaluateMergeGuards({
      source: client(),
      target: client({ clientId: 'target-1', mergedIntoClientId: 'elsewhere' }),
      targetAncestorClientIds: [],
    }).map((entry) => entry.code)).toContain('TARGET_ALREADY_MERGED');
  });

  it("refuses to absorb the tenant's own organisation record", () => {
    expect(evaluateMergeGuards({
      source: client({ isTenantDefault: true }),
      target: client({ clientId: 'target-1' }),
      targetAncestorClientIds: [],
    }).map((entry) => entry.code)).toContain('SOURCE_IS_TENANT_DEFAULT');
  });

  it('refuses a merge into one of the source\'s own recorded children', () => {
    expect(evaluateMergeGuards({
      source: client(),
      target: client({ clientId: 'target-1' }),
      // target's parent chain runs back through the source.
      targetAncestorClientIds: ['middle-1', 'source-1'],
    }).map((entry) => entry.code)).toContain('PARENT_LINK_CYCLE');
  });
});

describe('planBillingProfileMoves', () => {
  it('renames the source default to the source client name and keeps every id', () => {
    const plan = planBillingProfileMoves(
      [
        profile({ billing_profile_id: 'p-default', name: 'Default', is_default: true }),
        profile({ billing_profile_id: 'p-plant', name: 'North Plant', is_default: false }),
      ],
      'Acme North',
      [],
    );

    expect(plan.movedDefaultProfileId).toBe('p-default');
    expect(plan.moves.map((move) => move.billingProfileId).sort()).toEqual(['p-default', 'p-plant']);
    const movedDefault = plan.moves.find((move) => move.billingProfileId === 'p-default');
    expect(movedDefault).toMatchObject({ name: 'Acme North', renamedFrom: 'Default', wasSourceDefault: true });
    expect(plan.moves.find((move) => move.billingProfileId === 'p-plant')).toMatchObject({
      name: 'North Plant',
      renamedFrom: null,
    });
  });

  it('suffixes a name the target already uses rather than producing two identical profiles', () => {
    const plan = planBillingProfileMoves(
      [profile({ billing_profile_id: 'p-1', name: 'Acme North' })],
      'Acme North',
      ['Acme North'],
    );
    expect(plan.moves[0].name).toBe('Acme North (merged)');
    expect(plan.moves[0].renamedFrom).toBe('Acme North');
  });

  it('reports no default when the source somehow has none', () => {
    const plan = planBillingProfileMoves(
      [profile({ billing_profile_id: 'p-1', is_default: false, name: 'Orphan' })],
      'Acme North',
      [],
    );
    expect(plan.movedDefaultProfileId).toBeNull();
  });
});

describe('planContractMove', () => {
  it('moves with the original dates by default and stamps a NULL profile', () => {
    expect(planContractMove(contract(), undefined, 'moved-default')).toEqual({
      kind: 'move',
      clientContractId: 'cc-1',
      stampBillingProfileId: 'moved-default',
    });
  });

  it('leaves a contract that already names a profile alone', () => {
    expect(planContractMove(
      contract({ billingProfileId: 'explicit' }),
      { clientContractId: 'cc-1', choice: 'original' },
      'moved-default',
    )).toEqual({ kind: 'move', clientContractId: 'cc-1', stampBillingProfileId: null });
  });

  it('terminates the source the day before the clone starts', () => {
    expect(planContractMove(
      contract(),
      { clientContractId: 'cc-1', choice: 'cutover', cutoverDate: '2026-10-01' },
      'moved-default',
    )).toEqual({
      kind: 'cutover',
      clientContractId: 'cc-1',
      terminateAt: '2026-09-30',
      cutoverDate: '2026-10-01',
      stampBillingProfileId: 'moved-default',
    });
  });

  it('rejects a cutover outside the contract term rather than silently moving it', () => {
    expect(planContractMove(
      contract(),
      { clientContractId: 'cc-1', choice: 'cutover', cutoverDate: '2025-06-01' },
      null,
    ).kind).toBe('invalid');

    expect(planContractMove(
      contract({ endDate: '2026-06-30' }),
      { clientContractId: 'cc-1', choice: 'cutover', cutoverDate: '2026-12-01' },
      null,
    ).kind).toBe('invalid');

    expect(planContractMove(
      contract(),
      { clientContractId: 'cc-1', choice: 'cutover' },
      null,
    ).kind).toBe('invalid');
  });
});

describe('suggestCutoverDate', () => {
  it('suggests the first day of the following month, so no billing period is split', () => {
    expect(suggestCutoverDate(new Date('2026-09-23T12:00:00.000Z'))).toBe('2026-10-01');
    expect(suggestCutoverDate(new Date('2026-12-31T23:59:59.000Z'))).toBe('2027-01-01');
  });
});
