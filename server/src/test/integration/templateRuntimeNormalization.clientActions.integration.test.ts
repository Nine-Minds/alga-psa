import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTestService } from '../../../test-utils/billingTestHelpers';

let db: Knex;
let tenantId: string;
let userId: string;

let applyContractToClientAction: typeof import('../../../../packages/clients/src/actions/clientContractActions').applyContractToClient;
let addClientContractLineAction: typeof import('../../../../packages/clients/src/actions/clientContractLineActions').addClientContractLine;

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        {
          user_id: userId,
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        },
        { tenant: tenantId },
        ...args,
      ),
}));

async function insertClient(clientId: string) {
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Normalization Client ${clientId.slice(0, 8)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function insertContract(contractId: string, clientId: string, name: string) {
  await db('contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: name,
    contract_description: `${name} description`,
    owner_client_id: clientId,
    billing_frequency: 'monthly',
    currency_code: 'USD',
    is_active: true,
    is_template: false,
    status: 'Active',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function insertClientContract(
  clientContractId: string,
  clientId: string,
  contractId: string,
  templateContractId: string | null,
) {
  await db('client_contracts').insert({
    tenant: tenantId,
    client_contract_id: clientContractId,
    client_id: clientId,
    contract_id: contractId,
    template_contract_id: templateContractId,
    start_date: '2026-01-01',
    end_date: null,
    is_active: true,
    status: 'active',
    po_required: false,
    po_number: null,
    po_amount: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function insertTemplateArtifacts(templateContractId: string, templateLineId: string, serviceId: string) {
  await db('contract_templates').insert({
    tenant: tenantId,
    template_id: templateContractId,
    template_name: `Template ${templateContractId.slice(0, 8)}`,
    template_description: 'Normalization template source',
    default_billing_frequency: 'monthly',
    template_status: 'active',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('contract_template_lines').insert({
    tenant: tenantId,
    template_line_id: templateLineId,
    template_id: templateContractId,
    template_line_name: 'Managed Support',
    description: 'Template managed support line',
    billing_frequency: 'monthly',
    line_type: 'Fixed',
    custom_rate: 180,
    is_active: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('contract_template_line_services').insert({
    tenant: tenantId,
    template_line_id: templateLineId,
    service_id: serviceId,
    quantity: 1,
    custom_rate: 180,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

describe('Template runtime normalization client action integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    await db.migrate.latest();

    const existing = await db('tenants').first<{ tenant: string }>('tenant');
    if (existing?.tenant) {
      tenantId = existing.tenant;
    } else {
      tenantId = uuidv4();
      await db('tenants').insert({
        tenant: tenantId,
        client_name: 'Template runtime normalization tenant',
        email: 'template-runtime-normalization@test.local',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
    }

    userId = uuidv4();

    ({ applyContractToClient: applyContractToClientAction } = await import('../../../../packages/clients/src/actions/clientContractActions.ts'));
    ({ addClientContractLine: addClientContractLineAction } = await import('../../../../packages/clients/src/actions/clientContractLineActions.ts'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('T004/T018: applying a contract succeeds from explicit template provenance without runtime fallback reads', async () => {
    const clientId = uuidv4();
    const liveContractId = uuidv4();
    const clientContractId = uuidv4();
    const templateContractId = uuidv4();
    const templateLineId = uuidv4();

    await insertClient(clientId);
    const serviceId = await createTestService({ db, tenantId, clientId } as any, {
      service_name: 'Normalization Apply Service',
      billing_method: 'fixed',
      default_rate: 18000,
      unit_of_measure: 'month',
    });
    await insertContract(liveContractId, clientId, 'Normalization Apply Contract');
    await insertClientContract(clientContractId, clientId, liveContractId, templateContractId);
    await insertTemplateArtifacts(templateContractId, templateLineId, serviceId);

    await db('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: templateLineId,
      contract_id: liveContractId,
      contract_line_name: 'Managed Support',
      description: 'Live line awaiting template clone',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      billing_timing: 'arrears',
      cadence_owner: 'client',
      is_active: true,
      is_custom: false,
      custom_rate: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await applyContractToClientAction(clientContractId);

    const clonedServices = await db('contract_line_services')
      .where({
        tenant: tenantId,
        contract_line_id: templateLineId,
      })
      .select('service_id');

    expect(clonedServices.some((row) => row.service_id === serviceId)).toBe(true);
  }, 90_000);

  it('T005/T018: applying a contract fails closed when template provenance is missing', async () => {
    const clientId = uuidv4();
    const liveContractId = uuidv4();
    const clientContractId = uuidv4();
    const templateLineId = uuidv4();

    await insertClient(clientId);
    const serviceId = await createTestService({ db, tenantId, clientId } as any, {
      service_name: 'Normalization Apply Missing Provenance Service',
      billing_method: 'fixed',
      default_rate: 17500,
      unit_of_measure: 'month',
    });
    await insertContract(liveContractId, clientId, 'Normalization Missing Provenance Contract');
    await insertClientContract(clientContractId, clientId, liveContractId, null);

    await db('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: templateLineId,
      contract_id: liveContractId,
      contract_line_name: 'Managed Support Missing Provenance',
      description: 'Should fail closed',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      billing_timing: 'arrears',
      cadence_owner: 'client',
      is_active: true,
      is_custom: false,
      custom_rate: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await expect(applyContractToClientAction(clientContractId)).rejects.toThrow(
      `Client contract ${clientContractId} is missing template provenance (template_contract_id) required for template clone operations`,
    );

    const clonedServices = await db('contract_line_services')
      .where({
        tenant: tenantId,
        contract_line_id: templateLineId,
      })
      .select('service_id');

    expect(clonedServices.some((row) => row.service_id === serviceId)).toBe(false);
  }, 90_000);

  it('T007/T019: adding a contract line succeeds from explicit provenance without mixed runtime fallback', async () => {
    const clientId = uuidv4();
    const sourceContractId = uuidv4();
    const targetContractId = uuidv4();
    const clientContractId = uuidv4();
    const templateContractId = uuidv4();
    const templateLineId = uuidv4();

    await insertClient(clientId);
    const serviceId = await createTestService({ db, tenantId, clientId } as any, {
      service_name: 'Normalization Add Line Service',
      billing_method: 'fixed',
      default_rate: 16000,
      unit_of_measure: 'month',
    });

    await insertContract(sourceContractId, clientId, 'Normalization Source Contract');
    await insertContract(targetContractId, clientId, 'Normalization Target Contract');
    await insertClientContract(clientContractId, clientId, targetContractId, templateContractId);
    await insertTemplateArtifacts(templateContractId, templateLineId, serviceId);

    await db('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: templateLineId,
      contract_id: sourceContractId,
      contract_line_name: 'Managed Support Add Flow',
      description: 'Source line for add flow',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      billing_timing: 'arrears',
      cadence_owner: 'client',
      is_active: true,
      is_custom: false,
      custom_rate: 160,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await addClientContractLineAction({
      client_id: clientId,
      client_contract_id: clientContractId,
      contract_line_id: templateLineId,
      start_date: '2026-02-01',
      end_date: null,
      is_active: true,
      custom_rate: null,
    } as any);

    const clonedLines = await db('contract_lines')
      .where({
        tenant: tenantId,
        contract_id: targetContractId,
      })
      .andWhere('contract_line_id', '!=', templateLineId)
      .select('contract_line_id');

    expect(clonedLines.length).toBeGreaterThan(0);

    const clonedLineServices = await db('contract_line_services')
      .where({
        tenant: tenantId,
        service_id: serviceId,
      })
      .whereIn('contract_line_id', clonedLines.map((line) => line.contract_line_id))
      .select('contract_line_id');

    expect(clonedLineServices.length).toBeGreaterThan(0);
  }, 90_000);

  it('T008/T019: adding a contract line fails closed when required template provenance is missing', async () => {
    const clientId = uuidv4();
    const sourceContractId = uuidv4();
    const targetContractId = uuidv4();
    const clientContractId = uuidv4();
    const templateContractId = uuidv4();
    const templateLineId = uuidv4();

    await insertClient(clientId);
    const serviceId = await createTestService({ db, tenantId, clientId } as any, {
      service_name: 'Normalization Missing Add Line Provenance Service',
      billing_method: 'fixed',
      default_rate: 15000,
      unit_of_measure: 'month',
    });

    await insertContract(sourceContractId, clientId, 'Normalization Missing Add Source Contract');
    await insertContract(targetContractId, clientId, 'Normalization Missing Add Target Contract');
    await insertClientContract(clientContractId, clientId, targetContractId, null);
    await insertTemplateArtifacts(templateContractId, templateLineId, serviceId);

    await db('contract_lines').insert({
      tenant: tenantId,
      contract_line_id: templateLineId,
      contract_id: sourceContractId,
      contract_line_name: 'Missing provenance add source line',
      description: 'Should fail',
      billing_frequency: 'monthly',
      contract_line_type: 'Fixed',
      billing_timing: 'arrears',
      cadence_owner: 'client',
      is_active: true,
      is_custom: false,
      custom_rate: 150,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await expect(
      addClientContractLineAction({
        client_id: clientId,
        client_contract_id: clientContractId,
        contract_line_id: templateLineId,
        start_date: '2026-02-01',
        end_date: null,
        is_active: true,
      } as any),
    ).rejects.toThrow(
      `Client contract ${clientContractId} is missing template provenance (template_contract_id) required to clone template contract lines`,
    );

    const targetLines = await db('contract_lines')
      .where({
        tenant: tenantId,
        contract_id: targetContractId,
      })
      .select('contract_line_id');

    expect(targetLines.length).toBe(0);
  }, 90_000);
});
