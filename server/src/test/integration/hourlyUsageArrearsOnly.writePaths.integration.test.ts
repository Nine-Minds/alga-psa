import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  createSeatCatalog,
  createSeatClient,
  ensureFixtureTenant,
  tenantTable,
} from '../../../test-utils/perSeatFixtures';

// Plan §4.2 T6-T8 + T3: every real write entry point refuses (or resets) advance
// timing on Hourly/Usage contract lines. Fixed lines keep it.

let db: Knex;
let tenantId: string;
let serviceId: string;
let clientId: string;
let actions: {
  createClientContractFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createClientContractFromWizard;
  createContractTemplateFromWizard: typeof import('@alga-psa/billing/actions/contractWizardActions').createContractTemplateFromWizard;
  createCustomContractLine: typeof import('@alga-psa/billing/actions/contractLinePresetActions').createCustomContractLine;
  createContractLinePreset: typeof import('@alga-psa/billing/actions/contractLinePresetActions').createContractLinePreset;
  copyPresetToContractLine: typeof import('@alga-psa/billing/actions/contractLinePresetActions').copyPresetToContractLine;
  updateContractLine: typeof import('@alga-psa/billing/actions/contractLineAction').updateContractLine;
  updateContractLineRate: typeof import('@alga-psa/billing/actions/contractActions').updateContractLineRate;
  updateTemplateLineAssociation: typeof import('@alga-psa/billing/actions/contractLineMappingActions').updateContractLineAssociation;
};

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      (knexOrTrx as Knex).transaction((trx) => callback(trx)),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: 'arrears-only-test-user', tenant: tenantId, roles: [{ role_name: 'Admin' }] } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../test-utils/authModuleMock');
  const { withAuth } = await import('@alga-psa/auth/withAuth');
  return { ...createAuthModuleMock(), withAuth };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 180_000;
const ADVANCE_KEY = 'msp/contract-lines:errors.line.advanceTimingNotAllowed';

const PRESET_CHECK = {
  name: 'contract_line_presets_hourly_usage_not_advance_check',
  sql: `ALTER TABLE contract_line_presets ADD CONSTRAINT contract_line_presets_hourly_usage_not_advance_check `
    + `CHECK (NOT (contract_line_type IN ('Hourly', 'Usage') AND billing_timing = 'advance'))`,
};

function expectAdvanceRejected(result: unknown) {
  expect(result, JSON.stringify(result)).toMatchObject({ actionError: expect.any(String), messageKey: ADVANCE_KEY });
}

function ok<T>(result: T): T {
  expect(result, JSON.stringify(result)).toBeTruthy();
  expect(result).not.toHaveProperty('error');
  expect(result).not.toHaveProperty('actionError');
  return result;
}

async function lineRow(contractLineId: string) {
  return tenantTable(db, tenantId, 'contract_lines')
    .where({ tenant: tenantId, contract_line_id: contractLineId })
    .first();
}

/** A client contract with one Fixed line (timing as given), plus its ids. */
async function clientContract(billingTiming: 'advance' | 'arrears' = 'arrears') {
  return ok(
    await actions.createClientContractFromWizard({
      contract_name: `Arrears-only ${uuidv4().slice(0, 6)}`,
      client_id: clientId,
      start_date: '2025-02-01',
      end_date: '2025-12-31',
      billing_frequency: 'monthly',
      billing_timing: billingTiming,
      enable_proration: false,
      fixed_services: [{ service_id: serviceId, pricing_basis: 'unit', quantity: 1, unit_rate: 10000 }],
      hourly_services: [],
      usage_services: [],
    } as any),
  ) as { contract_id: string; contract_line_id: string };
}

const hourlyLineInput = (extra: Record<string, unknown> = {}) => ({
  contract_line_name: `Hourly ${uuidv4().slice(0, 6)}`,
  contract_line_type: 'Hourly' as const,
  billing_frequency: 'monthly',
  services: [{ service_id: serviceId, custom_rate: 11000 }],
  minimum_billable_time: 15,
  round_up_to_nearest: 15,
  ...extra,
});

async function hourlyLine(contractId: string): Promise<string> {
  const lineId = ok(await actions.createCustomContractLine(contractId, hourlyLineInput({ billing_timing: 'arrears' }) as any));
  expect(typeof lineId).toBe('string');
  return lineId as string;
}

describe('Hourly/Usage lines never store advance timing: write entry points', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureFixtureTenant(db);
    setupCommonMocks({ tenantId, userId: 'arrears-only-test-user', permissionCheck: () => true });
    const [catalogService] = await createSeatCatalog(db, tenantId, [{ name: 'Arrears Only Service', rateCents: 10000 }]);
    serviceId = catalogService.serviceId;
    clientId = (await createSeatClient(db, tenantId)).clientId;
    const wizard = await import('@alga-psa/billing/actions/contractWizardActions');
    const presetActions = await import('@alga-psa/billing/actions/contractLinePresetActions');
    actions = {
      createClientContractFromWizard: wizard.createClientContractFromWizard,
      createContractTemplateFromWizard: wizard.createContractTemplateFromWizard,
      createCustomContractLine: presetActions.createCustomContractLine,
      createContractLinePreset: presetActions.createContractLinePreset,
      copyPresetToContractLine: presetActions.copyPresetToContractLine,
      updateContractLine: (await import('@alga-psa/billing/actions/contractLineAction')).updateContractLine,
      updateContractLineRate: (await import('@alga-psa/billing/actions/contractActions')).updateContractLineRate,
      updateTemplateLineAssociation: (await import('@alga-psa/billing/actions/contractLineMappingActions')).updateContractLineAssociation,
    };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Never leave the preset CHECK dropped or missing.
    await db?.raw(`ALTER TABLE contract_line_presets DROP CONSTRAINT IF EXISTS ${PRESET_CHECK.name}`);
    await db?.raw(
      `UPDATE contract_line_presets SET billing_timing = 'arrears' `
      + `WHERE contract_line_type IN ('Hourly', 'Usage') AND billing_timing = 'advance'`,
    );
    await db?.raw(PRESET_CHECK.sql);
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('(a) createCustomContractLine rejects Hourly + advance with the catalogue key', async () => {
    const { contract_id } = await clientContract();
    expectAdvanceRejected(
      await actions.createCustomContractLine(contract_id, hourlyLineInput({ billing_timing: 'advance' }) as any),
    );
    // Usage is refused the same way; nothing was stored.
    expectAdvanceRejected(
      await actions.createCustomContractLine(contract_id, {
        contract_line_name: `Usage ${uuidv4().slice(0, 6)}`,
        contract_line_type: 'Usage',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        services: [{ service_id: serviceId, custom_rate: 100, unit_of_measure: 'unit' }],
      } as any),
    );
    const stored = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id })
      .whereIn('contract_line_type', ['Hourly', 'Usage']);
    expect(stored).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('(a) an Hourly line with no explicit timing is stored as arrears even when the contract is advance', async () => {
    const { contract_id } = await clientContract('advance');
    const lineId = ok(await actions.createCustomContractLine(contract_id, hourlyLineInput() as any)) as unknown as string;
    expect((await lineRow(lineId)).billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('(b) updateContractLine rejects explicit advance on an Hourly line and leaves it arrears', async () => {
    const { contract_id } = await clientContract();
    const lineId = await hourlyLine(contract_id);
    expectAdvanceRejected(await actions.updateContractLine(lineId, { billing_timing: 'advance' } as any));
    expect((await lineRow(lineId)).billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('(c) client-contract line edit (updateContractLineRate) rejects explicit advance on Hourly', async () => {
    const { contract_id } = await clientContract();
    const lineId = await hourlyLine(contract_id);
    expectAdvanceRejected(await actions.updateContractLineRate(contract_id, lineId, 12000, 'advance'));
    expect((await lineRow(lineId)).billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('(c) template line edit (updateContractLineAssociation) rejects explicit advance on Hourly', async () => {
    const template: any = ok(
      await actions.createContractTemplateFromWizard({
        contract_name: `Template ${uuidv4().slice(0, 6)}`,
        description: 'arrears-only template',
        billing_frequency: 'monthly',
        currency_code: 'USD',
        fixed_services: [],
        hourly_services: [{ service_id: serviceId, service_name: 'Arrears Only Service', hourly_rate: 11000 }],
        usage_services: [],
        enable_proration: false,
      } as any),
    );
    const templateLine = await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_id: template.contract_id, line_type: 'Hourly' })
      .first();
    expect(templateLine).toBeTruthy();
    expect(templateLine.billing_timing).toBe('arrears');

    const result = await actions.updateTemplateLineAssociation(
      template.contract_id,
      templateLine.template_line_id,
      { billing_timing: 'advance' } as any,
    );
    expectAdvanceRejected(result);
    const after = await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_line_id: templateLine.template_line_id })
      .first();
    expect(after.billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('(c) template line edit via updateContractLine rejects explicit advance on Hourly and leaves it arrears', async () => {
    const template: any = ok(
      await actions.createContractTemplateFromWizard({
        contract_name: `Template ${uuidv4().slice(0, 6)}`,
        description: 'arrears-only template',
        billing_frequency: 'monthly',
        currency_code: 'USD',
        fixed_services: [],
        hourly_services: [{ service_id: serviceId, service_name: 'Arrears Only Service', hourly_rate: 11000 }],
        usage_services: [],
        enable_proration: false,
      } as any),
    );
    const templateLine = await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_id: template.contract_id, line_type: 'Hourly' })
      .first();
    expect(templateLine.billing_timing).toBe('arrears');

    expectAdvanceRejected(await actions.updateContractLine(templateLine.template_line_id, { billing_timing: 'advance' } as any));
    const after = await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_line_id: templateLine.template_line_id })
      .first();
    expect(after.billing_timing).toBe('arrears');

    // A cadence-only edit still goes through and keeps the line arrears.
    ok(await actions.updateContractLine(templateLine.template_line_id, { cadence_owner: 'contract' } as any));
    const recadenced = await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_line_id: templateLine.template_line_id })
      .first();
    expect(recadenced.cadence_owner).toBe('contract');
    expect(recadenced.billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('(d) createContractLinePreset rejects Hourly + advance and stores nothing', async () => {
    const name = `Advance hourly preset ${uuidv4().slice(0, 6)}`;
    const result = await actions.createContractLinePreset({
      preset_name: name,
      contract_line_type: 'Hourly',
      billing_frequency: 'monthly',
      billing_timing: 'advance',
      cadence_owner: 'client',
    } as any);
    expectAdvanceRejected(result);
    const stored = await tenantTable(db, tenantId, 'contract_line_presets').where({ tenant: tenantId, preset_name: name });
    expect(stored).toHaveLength(0);
  }, HOOK_TIMEOUT);

  it('(e) changing a Fixed advance line to Hourly via updateContractLine resets timing to arrears', async () => {
    const { contract_line_id } = await clientContract('advance');
    expect((await lineRow(contract_line_id)).billing_timing).toBe('advance');

    ok(await actions.updateContractLine(contract_line_id, { contract_line_type: 'Hourly' } as any));
    const row = await lineRow(contract_line_id);
    expect(row.contract_line_type).toBe('Hourly');
    expect(row.billing_timing).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('(f) copyPresetToContractLine from a stale advance Hourly preset gives an arrears line, no error', async () => {
    const preset: any = ok(
      await actions.createContractLinePreset({
        preset_name: `Stale hourly preset ${uuidv4().slice(0, 6)}`,
        contract_line_type: 'Hourly',
        billing_frequency: 'monthly',
        billing_timing: 'arrears',
        cadence_owner: 'client',
      } as any),
    );
    // Legacy bad data: a preset stored before the rule existed. The CHECK is
    // dropped for the fixture and restored (VALID) in the finally block.
    await db.raw(`ALTER TABLE contract_line_presets DROP CONSTRAINT IF EXISTS ${PRESET_CHECK.name}`);
    try {
      await tenantTable(db, tenantId, 'contract_line_presets')
        .where({ tenant: tenantId, preset_id: preset.preset_id })
        .update({ billing_timing: 'advance' });
      const { contract_id } = await clientContract();

      const lineId = ok(await actions.copyPresetToContractLine(contract_id, preset.preset_id)) as unknown as string;
      expect(typeof lineId).toBe('string');
      const row = await lineRow(lineId);
      expect(row.contract_line_type).toBe('Hourly');
      expect(row.billing_timing).toBe('arrears');
    } finally {
      await db.raw(
        `UPDATE contract_line_presets SET billing_timing = 'arrears' `
        + `WHERE contract_line_type IN ('Hourly', 'Usage') AND billing_timing = 'advance'`,
      );
      await db.raw(PRESET_CHECK.sql);
    }
  }, HOOK_TIMEOUT);

  it('(g) createClientContractFromWizard: Fixed keeps advance, Hourly is arrears, no error', async () => {
    const result: any = ok(
      await actions.createClientContractFromWizard({
        contract_name: `Wizard ${uuidv4().slice(0, 6)}`,
        client_id: clientId,
        start_date: '2025-02-01',
        end_date: '2025-12-31',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        enable_proration: false,
        fixed_services: [{ service_id: serviceId, pricing_basis: 'unit', quantity: 1, unit_rate: 10000 }],
        hourly_services: [{ service_id: serviceId, hourly_rate: 11000 }],
        usage_services: [],
      } as any),
    );
    const lines = await tenantTable(db, tenantId, 'contract_lines')
      .where({ tenant: tenantId, contract_id: result.contract_id });
    const byType = new Map(lines.map((line: any) => [line.contract_line_type, line.billing_timing]));
    expect(byType.get('Fixed')).toBe('advance');
    expect(byType.get('Hourly')).toBe('arrears');
  }, HOOK_TIMEOUT);

  it('(g) createContractTemplateFromWizard: Fixed keeps advance, Hourly is arrears, no error', async () => {
    const result: any = ok(
      await actions.createContractTemplateFromWizard({
        contract_name: `Template ${uuidv4().slice(0, 6)}`,
        description: 'timing split',
        billing_frequency: 'monthly',
        billing_timing: 'advance',
        currency_code: 'USD',
        fixed_services: [{ service_id: serviceId, service_name: 'Arrears Only Service', quantity: 1 }],
        hourly_services: [{ service_id: serviceId, service_name: 'Arrears Only Service', hourly_rate: 11000 }],
        usage_services: [],
        fixed_base_rate: 10000,
        enable_proration: false,
      } as any),
    );
    const lines = await tenantTable(db, tenantId, 'contract_template_lines')
      .where({ tenant: tenantId, template_id: result.contract_id });
    const byType = new Map(lines.map((line: any) => [line.line_type, line.billing_timing]));
    expect(byType.get('Fixed')).toBe('advance');
    expect(byType.get('Hourly')).toBe('arrears');
  }, HOOK_TIMEOUT);
});
