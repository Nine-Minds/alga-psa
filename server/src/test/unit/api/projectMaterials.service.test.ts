import { beforeEach, describe, expect, it, vi } from 'vitest';

// T005 / F002 / F003 / F004 / F008 / F009: ProjectService material methods are thin callers of the
// inventory cores. They map typed core errors to HTTP and confirm ownership before delete.

const core = vi.hoisted(() => ({
  addMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
  listMaterials: vi.fn(),
}));

vi.mock('@alga-psa/inventory/lib', async (original) => ({
  ...(await original<typeof import('@alga-psa/inventory/lib')>()),
  addMaterial: core.addMaterial,
  deleteMaterial: core.deleteMaterial,
  listMaterials: core.listMaterials,
}));

import { InsufficientStockError, MaterialValidationError } from '@alga-psa/inventory/lib';
import { ProjectService } from '../../../lib/api/services/ProjectService';

const PROJECT = '22222222-2222-2222-2222-222222222222';
const OTHER_PROJECT = '99999999-9999-9999-9999-999999999999';
const MATERIAL = '55555555-5555-5555-5555-555555555555';
const SERVICE = '66666666-6666-6666-6666-666666666666';
const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

/** Fake knex: records where() filters and answers first() from `rows` by table name. */
function fakeKnex(rows: Record<string, unknown>) {
  const wheres: Record<string, unknown[]> = {};
  const knex = vi.fn((table: string) => {
    const builder: any = {
      where: vi.fn((cond: unknown) => { (wheres[table] ??= []).push(cond); return builder; }),
      select: vi.fn(() => builder),
      first: vi.fn(async () => rows[table]),
    };
    return builder;
  }) as any;
  return { knex, wheres };
}

function serviceWith(knex: unknown) {
  const service = new ProjectService();
  vi.spyOn(service as any, 'getDbForContext').mockResolvedValue(knex);
  return service;
}

const input = { service_id: SERVICE, quantity: 2, rate: 7500, currency_code: 'EUR', description: 'Drive' };
const loaded = { project_material_id: MATERIAL, project_id: PROJECT, service_name: 'SSD Drive', sku: 'SSD-1TB' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectService.getProjectMaterials', () => {
  it('delegates to listMaterials for the project and omits catalog cost fields', async () => {
    core.listMaterials.mockResolvedValue([
      { ...loaded, rate: '7500', catalog_unit_cost: 4000, catalog_cost_currency: 'EUR', from_staging_line_id: null },
    ]);
    const knex = {} as any;
    const rows = await serviceWith(knex).getProjectMaterials(PROJECT, context);
    expect(core.listMaterials).toHaveBeenCalledWith(knex, 'tenant-1', 'project', PROJECT);
    expect(rows).toEqual([{ ...loaded, rate: 7500, from_staging_line_id: null }]);
    expect(rows[0]).not.toHaveProperty('catalog_unit_cost');
  });
});

describe('ProjectService.addProjectMaterial', () => {
  it('F002/F003/F009: calls addMaterial for the project with no client_id and no allow_reserved_override', async () => {
    core.addMaterial.mockResolvedValue({ project_material_id: MATERIAL });
    const service = serviceWith({});
    vi.spyOn(service as any, 'getProjectMaterialById').mockResolvedValue(loaded);

    const result = await service.addProjectMaterial(PROJECT, {
      ...input,
      unit_id: 'unit-1',
      billing_destination: 'separate',
      billing_schedule_entry_id: null,
    } as any, context);

    expect(result).toBe(loaded);
    expect(core.addMaterial).toHaveBeenCalledTimes(1);
    const [, tenant, passed, performedBy] = core.addMaterial.mock.calls[0];
    expect(tenant).toBe('tenant-1');
    expect(performedBy).toBe('user-1');
    expect(passed).toEqual({
      parent_type: 'project',
      parent_id: PROJECT,
      service_id: SERVICE,
      quantity: 2,
      rate: 7500,
      currency_code: 'EUR',
      description: 'Drive',
      unit_id: 'unit-1',
      billing_destination: 'separate',
      billing_schedule_entry_id: null,
    });
    expect(passed).not.toHaveProperty('client_id');
    expect(passed).not.toHaveProperty('allow_reserved_override');
  });

  it('F008: an unknown project (path project_id) is a 404', async () => {
    core.addMaterial.mockRejectedValue(new MaterialValidationError('project not found', 'project_id'));
    await expect(serviceWith({}).addProjectMaterial(PROJECT, input, context)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it.each([
    ['service_id', 'service_id must reference an existing product'],
    ['unit_id', 'A serial-numbered unit must be selected for this product'],
    ['billing_destination', 'Products in EUR must use a separate product invoice'],
    ['client_id', 'project must be associated with a client'],
  ])('F008: MaterialValidationError on %s is a 400 carrying that field path', async (path, message) => {
    core.addMaterial.mockRejectedValue(new MaterialValidationError(message, path));
    await expect(serviceWith({}).addProjectMaterial(PROJECT, input, context)).rejects.toMatchObject({
      statusCode: 400,
      details: [{ path: [path], message }],
    });
  });

  it.each([
    ['short on hand', new InsufficientStockError('Insufficient stock: 1 available', 1, null)],
    ['reserved for a sales order', new InsufficientStockError('Stock is reserved for a sales order', 0, {
      reason: 'reserved', overrideable: true, requested: 2, free: 0, reserved: 2, held: 0, on_hand: 2,
    } as any)],
    ['held for a sales order', new InsufficientStockError('Stock is held for a sales order', 0, {
      reason: 'held', overrideable: false, requested: 2, free: 0, reserved: 0, held: 2, on_hand: 2,
    } as any)],
  ])('F009: stock %s is a 400 on quantity and nothing is loaded', async (_label, error) => {
    core.addMaterial.mockRejectedValue(error);
    const service = serviceWith({});
    const byId = vi.spyOn(service as any, 'getProjectMaterialById');
    await expect(service.addProjectMaterial(PROJECT, input, context)).rejects.toMatchObject({
      statusCode: 400,
      details: [{ path: ['quantity'], message: (error as Error).message }],
    });
    expect(byId).not.toHaveBeenCalled();
  });

  it('does not swallow unexpected errors', async () => {
    core.addMaterial.mockRejectedValue(new Error('connection reset'));
    await expect(serviceWith({}).addProjectMaterial(PROJECT, input, context)).rejects.toThrow('connection reset');
  });
});

describe('ProjectService.deleteProjectMaterial', () => {
  it('F004: deletes through the core after confirming the material belongs to the project in this tenant', async () => {
    const { knex, wheres } = fakeKnex({ project_materials: { project_material_id: MATERIAL } });
    core.deleteMaterial.mockResolvedValue(true);

    await expect(serviceWith(knex).deleteProjectMaterial(PROJECT, MATERIAL, context)).resolves.toBeUndefined();

    expect(wheres.project_materials).toEqual(expect.arrayContaining([
      { project_material_id: MATERIAL, project_id: PROJECT },
    ]));
    expect(core.deleteMaterial).toHaveBeenCalledWith(knex, 'tenant-1', 'project', MATERIAL, 'user-1');
  });

  it("a material that is not this project's is a 404 and the core is never called", async () => {
    const { knex, wheres } = fakeKnex({ project_materials: undefined });
    await expect(serviceWith(knex).deleteProjectMaterial(OTHER_PROJECT, MATERIAL, context)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(wheres.project_materials).toEqual(expect.arrayContaining([
      { project_material_id: MATERIAL, project_id: OTHER_PROJECT },
    ]));
    expect(core.deleteMaterial).not.toHaveBeenCalled();
  });

  it('a core that reports the material gone is a 404', async () => {
    const { knex } = fakeKnex({ project_materials: { project_material_id: MATERIAL } });
    core.deleteMaterial.mockResolvedValue(false);
    await expect(serviceWith(knex).deleteProjectMaterial(PROJECT, MATERIAL, context)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('a billed material is a 409', async () => {
    const { knex } = fakeKnex({ project_materials: { project_material_id: MATERIAL } });
    core.deleteMaterial.mockRejectedValue(new Error('Cannot delete a billed material.'));
    await expect(serviceWith(knex).deleteProjectMaterial(PROJECT, MATERIAL, context)).rejects.toMatchObject({ statusCode: 409 });
  });
});
