import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  new URL('../../../../migrations/20260316121000_client_owned_contracts_simplification.cjs', import.meta.url),
  'utf8'
);

const helperModule = await import('../../../../migrations/utils/client_owned_contracts_simplification.cjs');

const {
  detectSharedNonTemplateContractGroups,
  selectPreservedAssignment,
  assertCloneTargetsSupported,
  buildSharedContractClonePlan,
} = helperModule;

function buildKnownSharedContractPlans() {
  let counter = 0;
  const createId = (prefix: string) => `${prefix}-known-${++counter}`;

  const managedItAssignments = [
    {
      tenant: 'cross-industries',
      contract_id: 'contract-managed-it-services',
      client_contract_id: 'cc-green-thumb',
      client_id: 'client-green-thumb',
      client_name: 'The Green Thumb',
      is_template: false,
      start_date: '2025-01-01',
      invoice_count: 4,
    },
    {
      tenant: 'cross-industries',
      contract_id: 'contract-managed-it-services',
      client_contract_id: 'cc-btm-machinery',
      client_id: 'client-btm-machinery',
      client_name: 'BTM Machinery',
      is_template: false,
      start_date: '2025-02-01',
      invoice_count: 0,
    },
  ];

  const managedItPlan = buildSharedContractClonePlan(
    {
      sourceContract: {
        tenant: 'cross-industries',
        contract_id: 'contract-managed-it-services',
        contract_name: 'Managed IT Services',
        billing_frequency: 'monthly',
        currency_code: 'USD',
        is_active: true,
        status: 'active',
        is_template: false,
        owner_client_id: null,
      },
      assignments: managedItAssignments,
      contractLines: [
        {
          tenant: 'cross-industries',
          contract_line_id: 'managed-line-1',
          contract_id: 'contract-managed-it-services',
          contract_line_name: 'Managed IT Base',
        },
        {
          tenant: 'cross-industries',
          contract_line_id: 'managed-line-2',
          contract_id: 'contract-managed-it-services',
          contract_line_name: 'Managed IT Add-on',
        },
      ],
      contractLineServices: [
        { tenant: 'cross-industries', contract_line_id: 'managed-line-1', service_id: 'svc-managed-base', quantity: 1 },
        { tenant: 'cross-industries', contract_line_id: 'managed-line-2', service_id: 'svc-managed-addon', quantity: 1 },
      ],
      contractLineServiceConfigurations: [
        {
          tenant: 'cross-industries',
          config_id: 'managed-config-1',
          contract_line_id: 'managed-line-1',
          service_id: 'svc-managed-base',
          configuration_type: 'Fixed',
        },
      ],
      contractLineServiceFixedConfigs: [
        {
          tenant: 'cross-industries',
          config_id: 'managed-config-1',
          base_rate: 20000,
        },
      ],
    },
    { createId }
  );

  const worryFreeAssignments = [
    {
      tenant: 'worrynot-works',
      contract_id: 'contract-worry-free-essentials',
      client_contract_id: 'cc-worrynot-works',
      client_id: 'client-worrynot-works',
      client_name: 'WorryNot Works IT Services',
      is_template: false,
      start_date: '2025-01-15',
      invoice_count: 0,
    },
    {
      tenant: 'worrynot-works',
      contract_id: 'contract-worry-free-essentials',
      client_contract_id: 'cc-benjamin-wolf-group',
      client_id: 'client-benjamin-wolf-group',
      client_name: 'The Benjamin Wolf Group',
      is_template: false,
      start_date: '2025-02-15',
      invoice_count: 0,
    },
  ];

  const worryFreePlan = buildSharedContractClonePlan(
    {
      sourceContract: {
        tenant: 'worrynot-works',
        contract_id: 'contract-worry-free-essentials',
        contract_name: 'Worry-Free Essentials',
        billing_frequency: 'monthly',
        currency_code: 'USD',
        is_active: true,
        status: 'active',
        is_template: false,
        owner_client_id: null,
      },
      assignments: worryFreeAssignments,
      contractLines: [
        {
          tenant: 'worrynot-works',
          contract_line_id: 'worry-line-1',
          contract_id: 'contract-worry-free-essentials',
          contract_line_name: 'Essentials Base',
        },
        {
          tenant: 'worrynot-works',
          contract_line_id: 'worry-line-2',
          contract_id: 'contract-worry-free-essentials',
          contract_line_name: 'Essentials Support',
        },
      ],
      contractLineServices: [
        { tenant: 'worrynot-works', contract_line_id: 'worry-line-1', service_id: 'svc-essentials-base', quantity: 1 },
        { tenant: 'worrynot-works', contract_line_id: 'worry-line-2', service_id: 'svc-essentials-support', quantity: 1 },
      ],
      contractLineServiceConfigurations: [
        {
          tenant: 'worrynot-works',
          config_id: 'worry-config-1',
          contract_line_id: 'worry-line-1',
          service_id: 'svc-essentials-base',
          configuration_type: 'Fixed',
        },
      ],
      contractLineServiceFixedConfigs: [
        {
          tenant: 'worrynot-works',
          config_id: 'worry-config-1',
          base_rate: 15000,
        },
      ],
    },
    { createId }
  );

  return {
    managedItAssignments,
    managedItPlan,
    worryFreeAssignments,
    worryFreePlan,
  };
}

describe('client-owned contracts simplification migration', () => {
  it('T001: adds contracts.owner_client_id while only planning shared non-template contract splits', () => {
    expect(migrationSource).toContain("table.uuid('owner_client_id').nullable()");
  });

  it('T003: identifies shared non-template contracts while leaving template reuse untouched', () => {
    const sharedGroups = detectSharedNonTemplateContractGroups([
      {
        tenant: 'tenant-1',
        contract_id: 'template-contract',
        client_contract_id: 'cc-template-1',
        client_id: 'client-a',
        is_template: true,
        start_date: '2026-01-01',
      },
      {
        tenant: 'tenant-1',
        contract_id: 'template-contract',
        client_contract_id: 'cc-template-2',
        client_id: 'client-b',
        is_template: true,
        start_date: '2026-01-02',
      },
      {
        tenant: 'tenant-1',
        contract_id: 'shared-contract',
        client_contract_id: 'cc-1',
        client_id: 'client-a',
        is_template: false,
        start_date: '2026-01-01',
      },
      {
        tenant: 'tenant-1',
        contract_id: 'shared-contract',
        client_contract_id: 'cc-2',
        client_id: 'client-b',
        is_template: false,
        start_date: '2026-01-02',
      },
    ]);

    expect(sharedGroups).toHaveLength(1);
    expect(sharedGroups[0].map((row: any) => row.client_contract_id)).toEqual(['cc-1', 'cc-2']);
  });

  it('T004: preserves the only invoiced assignment when invoice history exists on exactly one assignment', () => {
    const result = selectPreservedAssignment([
      {
        client_contract_id: 'cc-older',
        client_id: 'client-a',
        start_date: '2026-01-01',
        invoice_count: 3,
      },
      {
        client_contract_id: 'cc-newer',
        client_id: 'client-b',
        start_date: '2025-12-01',
        invoice_count: 0,
      },
    ]);

    expect(result.reason).toBe('single_invoiced_assignment');
    expect(result.preservedAssignment.client_contract_id).toBe('cc-older');
  });

  it('T005: preserves the earliest starting assignment when there is no invoice history', () => {
    const result = selectPreservedAssignment([
      {
        client_contract_id: 'cc-later',
        client_id: 'client-b',
        start_date: '2026-02-01',
        invoice_count: 0,
      },
      {
        client_contract_id: 'cc-earlier',
        client_id: 'client-a',
        start_date: '2026-01-15',
        invoice_count: 0,
      },
    ]);

    expect(result.reason).toBe('earliest_start_date');
    expect(result.preservedAssignment.client_contract_id).toBe('cc-earlier');
  });

  it('T006/T007/T008/T009/T010/T011: builds a deterministic clone plan that backfills the preserved owner, clones contract rows and lines, and repoints clone-target assignments', () => {
    let counter = 0;
    const createId = (prefix: string) => `${prefix}-clone-${++counter}`;

    const plan = buildSharedContractClonePlan(
      {
        sourceContract: {
          tenant: 'tenant-1',
          contract_id: 'contract-1',
          contract_name: 'Managed IT Services',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          is_active: true,
          status: 'active',
          is_template: false,
          owner_client_id: null,
        },
        assignments: [
          {
            tenant: 'tenant-1',
            client_contract_id: 'cc-preserved',
            client_id: 'client-a',
            start_date: '2026-01-01',
            invoice_count: 2,
          },
          {
            tenant: 'tenant-1',
            client_contract_id: 'cc-clone',
            client_id: 'client-b',
            start_date: '2026-02-01',
            invoice_count: 0,
          },
        ],
        contractLines: [
          {
            tenant: 'tenant-1',
            contract_line_id: 'line-1',
            contract_id: 'contract-1',
            contract_line_name: 'Line 1',
          },
          {
            tenant: 'tenant-1',
            contract_line_id: 'line-2',
            contract_id: 'contract-1',
            contract_line_name: 'Line 2',
          },
        ],
        contractLineServices: [
          { tenant: 'tenant-1', contract_line_id: 'line-1', service_id: 'svc-1', quantity: 1 },
        ],
        contractLineServiceDefaults: [
          {
            tenant: 'tenant-1',
            default_id: 'default-1',
            contract_line_id: 'line-1',
            service_id: 'svc-1',
          },
        ],
        contractLineDiscounts: [
          {
            tenant: 'tenant-1',
            discount_id: 'discount-1',
            contract_line_id: 'line-2',
          },
        ],
        contractLineServiceConfigurations: [
          {
            tenant: 'tenant-1',
            config_id: 'config-1',
            contract_line_id: 'line-1',
            service_id: 'svc-1',
            configuration_type: 'Fixed',
          },
        ],
        contractLineServiceFixedConfigs: [
          {
            tenant: 'tenant-1',
            config_id: 'config-1',
            base_rate: 10000,
          },
        ],
        contractLineServiceRateTiers: [
          {
            tenant: 'tenant-1',
            tier_id: 'tier-1',
            config_id: 'config-1',
            min_quantity: 1,
            rate: 10000,
          },
        ],
      },
      { createId }
    );

    expect(plan.preservedContractUpdate).toEqual({
      contract_id: 'contract-1',
      owner_client_id: 'client-a',
    });
    expect(plan.reason).toBe('single_invoiced_assignment');
    expect(plan.preservedAssignment.client_contract_id).toBe('cc-preserved');
    expect(plan.clones).toHaveLength(1);

    const [clone] = plan.clones;
    expect(clone.contract.contract_id).not.toBe('contract-1');
    expect(clone.contract.owner_client_id).toBe('client-b');
    expect(clone.clientContractUpdate).toEqual({
      client_contract_id: 'cc-clone',
      contract_id: clone.contract.contract_id,
    });
    expect(clone.contractLines).toHaveLength(2);
    expect(clone.contractLines.every((row: any) => row.contract_id === clone.contract.contract_id)).toBe(true);
    expect(clone.contractLines.every((row: any) => row.contract_line_id !== 'line-1' && row.contract_line_id !== 'line-2')).toBe(true);
    expect(clone.contractLineServices[0].contract_line_id).toBe(clone.contractLines[0].contract_line_id);
    expect(clone.contractLineServiceDefaults[0].default_id).not.toBe('default-1');
    expect(clone.contractLineDiscounts[0].discount_id).not.toBe('discount-1');
    expect(clone.contractLineServiceConfigurations[0].config_id).not.toBe('config-1');
    expect(clone.contractLineServiceFixedConfigs[0].config_id).toBe(
      clone.contractLineServiceConfigurations[0].config_id
    );
    expect(clone.contractLineServiceRateTiers[0].tier_id).not.toBe('tier-1');
    expect(clone.contractLineServiceRateTiers[0].config_id).toBe(
      clone.contractLineServiceConfigurations[0].config_id
    );
  });

  it('T012: aborts shared-contract groups that require unsupported historical reference retargeting', () => {
    expect(() =>
      assertCloneTargetsSupported({
        tenant: 'tenant-1',
        contractId: 'contract-1',
        cloneTargets: [{ client_contract_id: 'cc-clone', invoice_count: 0 }],
        contractDocumentAssociationsCount: 1,
        pricingScheduleCount: 0,
        timeEntryCount: 0,
        usageTrackingCount: 0,
      })
    ).toThrow(/document associations/i);

    expect(() =>
      assertCloneTargetsSupported({
        tenant: 'tenant-1',
        contractId: 'contract-1',
        cloneTargets: [{ client_contract_id: 'cc-clone', invoice_count: 2 }],
        contractDocumentAssociationsCount: 0,
        pricingScheduleCount: 1,
        timeEntryCount: 0,
        usageTrackingCount: 0,
      })
    ).toThrow(/pricing schedules/i);
  });

  it('T035/T036/T037: preserves Managed IT Services on The Green Thumb, clones BTM Machinery, and removes multi-client sharing from the post-migration assignments', () => {
    const { managedItAssignments, managedItPlan } = buildKnownSharedContractPlans();
    const [managedClone] = managedItPlan.clones;

    expect(managedItPlan.reason).toBe('single_invoiced_assignment');
    expect(managedItPlan.preservedAssignment.client_contract_id).toBe('cc-green-thumb');
    expect(managedItPlan.preservedContractUpdate).toEqual({
      contract_id: 'contract-managed-it-services',
      owner_client_id: 'client-green-thumb',
    });
    expect(managedClone.clientContractUpdate).toEqual({
      client_contract_id: 'cc-btm-machinery',
      contract_id: managedClone.contract.contract_id,
    });
    expect(managedClone.contract.contract_id).not.toBe('contract-managed-it-services');

    const postMigrationAssignments = managedItAssignments.map((assignment) =>
      assignment.client_contract_id === managedClone.clientContractUpdate.client_contract_id
        ? { ...assignment, contract_id: managedClone.clientContractUpdate.contract_id }
        : assignment
    );

    expect(
      detectSharedNonTemplateContractGroups(postMigrationAssignments.map((assignment) => ({
        ...assignment,
        is_template: false,
      })))
    ).toEqual([]);
  });

  it('T038/T039/T040: preserves Worry-Free Essentials on the earliest assignment, clones The Benjamin Wolf Group, and keeps cloned line counts aligned', () => {
    const { worryFreePlan } = buildKnownSharedContractPlans();
    const [worryClone] = worryFreePlan.clones;

    expect(worryFreePlan.reason).toBe('earliest_start_date');
    expect(worryFreePlan.preservedAssignment.client_contract_id).toBe('cc-worrynot-works');
    expect(worryFreePlan.preservedContractUpdate).toEqual({
      contract_id: 'contract-worry-free-essentials',
      owner_client_id: 'client-worrynot-works',
    });
    expect(worryClone.clientContractUpdate).toEqual({
      client_contract_id: 'cc-benjamin-wolf-group',
      contract_id: worryClone.contract.contract_id,
    });
    expect(worryClone.contract.contract_id).not.toBe('contract-worry-free-essentials');
    expect(worryClone.contractLines).toHaveLength(2);
    expect(worryClone.contractLines.map((line: any) => line.contract_line_name)).toEqual([
      'Essentials Base',
      'Essentials Support',
    ]);
    expect(worryClone.contractLines.every((line: any) => line.contract_id === worryClone.contract.contract_id)).toBe(true);
  });

  it('T041: known production clone-target assignments match the validated preflight assumption of no unsupported historical references', () => {
    const { managedItPlan, worryFreePlan } = buildKnownSharedContractPlans();

    expect(() =>
      assertCloneTargetsSupported({
        tenant: managedItPlan.tenant,
        contractId: managedItPlan.contractId,
        cloneTargets: managedItPlan.clones.map((clone: any) => clone.sourceAssignment),
        contractDocumentAssociationsCount: 0,
        pricingScheduleCount: 0,
        timeEntryCount: 0,
        usageTrackingCount: 0,
      })
    ).not.toThrow();

    expect(() =>
      assertCloneTargetsSupported({
        tenant: worryFreePlan.tenant,
        contractId: worryFreePlan.contractId,
        cloneTargets: worryFreePlan.clones.map((clone: any) => clone.sourceAssignment),
        contractDocumentAssociationsCount: 0,
        pricingScheduleCount: 0,
        timeEntryCount: 0,
        usageTrackingCount: 0,
      })
    ).not.toThrow();
  });
});
