import { SharedNumberingService } from '@shared/services/numberingService';
import { Knex } from 'knex';
import { vi } from 'vitest';

// getNextNumber self-initializes the next_number row for every entity type (so
// a tenant's first invoice/project number carries the right prefix instead of
// the table's TIC default) and then reads the row back for its optional
// prefix_date_format. Both run through tenantDb before the raw
// generate_next_number call; stub it so these tests exercise the generation
// logic, not the scoped-query plumbing.
const mocks = vi.hoisted(() => ({
  settings: { prefix: 'PRJ-', prefix_date_format: null } as
    | { prefix?: string | null; prefix_date_format?: string | null }
    | undefined,
  seedInserts: [] as Record<string, unknown>[],
  resolveEffectiveTimeZone: vi.fn(async (): Promise<string> => 'UTC'),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    resolveEffectiveTimeZone: mocks.resolveEffectiveTimeZone,
    tenantDb: vi.fn(() => ({
      table: vi.fn(() => ({
        insert: vi.fn((row: Record<string, unknown>) => {
          mocks.seedInserts.push(row);
          return {
            onConflict: vi.fn(() => ({
              ignore: vi.fn(() => Promise.resolve()),
            })),
          };
        }),
        where: vi.fn(() => ({
          select: vi.fn(() => ({
            first: vi.fn(() => Promise.resolve(mocks.settings)),
          })),
        })),
      })),
    })),
  };
});

describe('SharedNumberingService', () => {
  let mockKnex: any;
  const mockTenant = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockKnex = {
      raw: vi.fn()
    };
    mocks.settings = { prefix: 'PRJ-', prefix_date_format: null };
    mocks.seedInserts.length = 0;
    mocks.resolveEffectiveTimeZone.mockClear();
    mocks.resolveEffectiveTimeZone.mockResolvedValue('UTC');
  });

  describe('getNextNumber', () => {
    it('should generate next PROJECT number', async () => {
      mockKnex.raw.mockResolvedValue({
        rows: [{ number: 'PRJ-0001' }]
      });

      const result = await SharedNumberingService.getNextNumber(
        'PROJECT',
        { knex: mockKnex, tenant: mockTenant }
      );

      expect(result).toBe('PRJ-0001');
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT generate_next_number(:tenant::uuid, :type::text) as number',
        { tenant: mockTenant, type: 'PROJECT' }
      );
    });

    it('should generate sequential PROJECT numbers', async () => {
      mockKnex.raw
        .mockResolvedValueOnce({ rows: [{ number: 'PRJ-0001' }] })
        .mockResolvedValueOnce({ rows: [{ number: 'PRJ-0002' }] })
        .mockResolvedValueOnce({ rows: [{ number: 'PRJ-0003' }] });

      const result1 = await SharedNumberingService.getNextNumber('PROJECT', { knex: mockKnex, tenant: mockTenant });
      const result2 = await SharedNumberingService.getNextNumber('PROJECT', { knex: mockKnex, tenant: mockTenant });
      const result3 = await SharedNumberingService.getNextNumber('PROJECT', { knex: mockKnex, tenant: mockTenant });

      expect(result1).toBe('PRJ-0001');
      expect(result2).toBe('PRJ-0002');
      expect(result3).toBe('PRJ-0003');
    });

    it('should throw error when tenant is missing', async () => {
      await expect(
        SharedNumberingService.getNextNumber('PROJECT', { knex: mockKnex, tenant: '' })
      ).rejects.toThrow('Tenant context is required for generating project numbers');
    });

    it('should throw error when number generation fails', async () => {
      mockKnex.raw.mockResolvedValue({ rows: [] });

      await expect(
        SharedNumberingService.getNextNumber('PROJECT', { knex: mockKnex, tenant: mockTenant })
      ).rejects.toThrow('Failed to generate project number for tenant');
    });

    it('should handle database errors gracefully', async () => {
      mockKnex.raw.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        SharedNumberingService.getNextNumber('PROJECT', { knex: mockKnex, tenant: mockTenant })
      ).rejects.toThrow('Failed to generate project number in tenant');
    });

    it('seeds PURCHASE_ORDER with the PO defaults the consolidated callers rely on', async () => {
      mocks.settings = { prefix: 'PO', prefix_date_format: null };
      mockKnex.raw.mockResolvedValue({ rows: [{ number: 'PO00001' }] });

      const result = await SharedNumberingService.getNextNumber('PURCHASE_ORDER', { knex: mockKnex, tenant: mockTenant });

      expect(result).toBe('PO00001');
      expect(mocks.seedInserts[0]).toEqual({
        tenant: mockTenant,
        entity_type: 'PURCHASE_ORDER',
        last_number: 0,
        prefix: 'PO',
        padding_length: 5,
        initial_value: 1,
      });
    });
  });

  describe('prefix_date_format', () => {
    it('returns the generated number untouched when no format is configured', async () => {
      mockKnex.raw.mockResolvedValue({ rows: [{ number: 'PRJ-0001' }] });

      const result = await SharedNumberingService.getNextNumber('PROJECT', { knex: mockKnex, tenant: mockTenant });

      expect(result).toBe('PRJ-0001');
      // No format means no timezone lookup at all — the pre-change code path.
      expect(mocks.resolveEffectiveTimeZone).not.toHaveBeenCalled();
    });

    it('splices the expanded date between the prefix and the padded counter', async () => {
      mocks.settings = { prefix: 'INV-', prefix_date_format: '{YYYY}-{MM}-{DD}-' };
      mocks.resolveEffectiveTimeZone.mockResolvedValue('Australia/Sydney');
      mockKnex.raw.mockResolvedValue({ rows: [{ number: 'INV-000005' }] });

      const result = await SharedNumberingService.getNextNumber(
        'INVOICE',
        { knex: mockKnex, tenant: mockTenant },
        { date: new Date('2026-08-31T15:00:00Z') }
      );

      // 15:00Z on the 31st is already the 1st in Sydney.
      expect(result).toBe('INV-2026-09-01-000005');
      expect(mocks.resolveEffectiveTimeZone).toHaveBeenCalledWith(mockKnex, mockTenant);
    });

    it('honours an explicit timezone override', async () => {
      mocks.settings = { prefix: 'INV-', prefix_date_format: '{YYYY}-{MM}-{DD}-' };
      mockKnex.raw.mockResolvedValue({ rows: [{ number: 'INV-000005' }] });

      const result = await SharedNumberingService.getNextNumber(
        'INVOICE',
        { knex: mockKnex, tenant: mockTenant },
        { date: new Date('2026-08-31T15:00:00Z'), timeZone: 'UTC' }
      );

      expect(result).toBe('INV-2026-08-31-000005');
      expect(mocks.resolveEffectiveTimeZone).not.toHaveBeenCalled();
    });

    it('handles an empty prefix by prepending the expanded date', async () => {
      mocks.settings = { prefix: '', prefix_date_format: '{YYYY}' };
      mockKnex.raw.mockResolvedValue({ rows: [{ number: '000005' }] });

      const result = await SharedNumberingService.getNextNumber(
        'INVOICE',
        { knex: mockKnex, tenant: mockTenant },
        { date: new Date('2026-08-31T15:00:00Z'), timeZone: 'UTC' }
      );

      expect(result).toBe('2026000005');
    });

    it('returns the raw number when the generated value does not start with the prefix', async () => {
      mocks.settings = { prefix: 'INV-', prefix_date_format: '{YYYY}-' };
      mockKnex.raw.mockResolvedValue({ rows: [{ number: 'LEGACY-000005' }] });

      const result = await SharedNumberingService.getNextNumber(
        'INVOICE',
        { knex: mockKnex, tenant: mockTenant },
        { date: new Date('2026-08-31T15:00:00Z'), timeZone: 'UTC' }
      );

      expect(result).toBe('LEGACY-000005');
    });
  });
});
