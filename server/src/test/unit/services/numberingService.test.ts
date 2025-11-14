import { SharedNumberingService } from '@shared/services/numberingService';
import { Knex } from 'knex';

describe('SharedNumberingService', () => {
  let mockKnex: any;
  const mockTenant = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockKnex = {
      raw: jest.fn()
    };
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
  });
});
