import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TicketService } from '../../../lib/api/services/TicketService';

function createMaterialsListBuilder(rows: unknown[]) {
  const builder = {
    leftJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    select: vi.fn(() => builder),
    orderBy: vi.fn().mockResolvedValue(rows),
  };

  return builder;
}

function createTicketBuilder(ticket: unknown) {
  return {
    where: vi.fn(() => ({
      select: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(ticket),
      })),
    })),
  };
}

function createProductBuilder(product: unknown) {
  return {
    where: vi.fn(() => ({
      select: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(product),
      })),
    })),
  };
}

describe('TicketService materials', () => {
  const ticketId = '123e4567-e89b-12d3-a456-426614174000';
  const materialId = '223e4567-e89b-12d3-a456-426614174000';
  const context = {
    tenant: 'tenant-1',
    userId: 'user-1',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T030: lists ticket materials with joined product names and sku', async () => {
    const service = new TicketService();
    const rows = [
      {
        ticket_material_id: materialId,
        ticket_id: ticketId,
        service_id: 'service-1',
        service_name: 'SSD Drive',
        sku: 'SSD-1TB',
        quantity: 2,
        rate: 7500,
        currency_code: 'USD',
        is_billed: false,
      },
    ];

    const knex = vi.fn((table: string) => {
      if (table === 'ticket_materials as tm') {
        return createMaterialsListBuilder(rows);
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });

    await expect(service.getTicketMaterials(ticketId, context)).resolves.toEqual(rows);
  });

  it('T031: returns an empty array when a ticket has no materials', async () => {
    const service = new TicketService();
    const knex = vi.fn((table: string) => {
      if (table === 'ticket_materials as tm') {
        return createMaterialsListBuilder([]);
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });

    await expect(service.getTicketMaterials(ticketId, context)).resolves.toEqual([]);
  });

  it('T032/T033: creates a material with valid data and resolves client_id from the ticket', async () => {
    const service = new TicketService();
    const insertSpy = vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ ticket_material_id: materialId }]),
    }));

    const knex = vi.fn((table: string) => {
      if (table === 'tickets') {
        return createTicketBuilder({ ticket_id: ticketId, client_id: 'client-1' });
      }

      if (table === 'service_catalog') {
        return createProductBuilder({ service_id: 'service-1' });
      }

      if (table === 'ticket_materials') {
        return {
          insert: insertSpy,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getTicketMaterialById').mockResolvedValue({
      ticket_material_id: materialId,
      ticket_id: ticketId,
      client_id: 'client-1',
      service_id: 'service-1',
      service_name: 'SSD Drive',
      sku: 'SSD-1TB',
      quantity: 2,
      rate: 7500,
      currency_code: 'USD',
      is_billed: false,
    });

    const result = await service.addTicketMaterial(ticketId, {
      service_id: 'service-1',
      quantity: 2,
      rate: 7500,
      currency_code: 'USD',
      description: 'Replacement drive',
    }, context);

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      ticket_id: ticketId,
      client_id: 'client-1',
      service_id: 'service-1',
      quantity: 2,
      rate: 7500,
      currency_code: 'USD',
      description: 'Replacement drive',
      is_billed: false,
      tenant: 'tenant-1',
    }));
    expect(result).toMatchObject({
      ticket_material_id: materialId,
      service_name: 'SSD Drive',
      sku: 'SSD-1TB',
    });
  });

  it('T034: rejects invalid quantity and rate values', async () => {
    const service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: vi.fn() });

    await expect(service.addTicketMaterial(ticketId, {
      service_id: 'service-1',
      quantity: 0,
      rate: 7500,
      currency_code: 'USD',
    } as any, context)).rejects.toMatchObject({
      details: [expect.objectContaining({ path: ['quantity'], message: 'quantity must be greater than 0' })],
    });

    await expect(service.addTicketMaterial(ticketId, {
      service_id: 'service-1',
      quantity: 1,
      rate: -1,
      currency_code: 'USD',
    } as any, context)).rejects.toMatchObject({
      details: [expect.objectContaining({ path: ['rate'], message: 'rate must be 0 or greater' })],
    });
  });

  it('T035: rejects a service_id that is not a product in the catalog', async () => {
    const service = new TicketService();
    const knex = vi.fn((table: string) => {
      if (table === 'tickets') {
        return createTicketBuilder({ ticket_id: ticketId, client_id: 'client-1' });
      }

      if (table === 'service_catalog') {
        return createProductBuilder(null);
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });

    await expect(service.addTicketMaterial(ticketId, {
      service_id: 'service-404',
      quantity: 1,
      rate: 7500,
      currency_code: 'USD',
    }, context)).rejects.toMatchObject({
      details: [expect.objectContaining({ path: ['service_id'], message: 'service_id must reference an existing product' })],
    });
  });
});
