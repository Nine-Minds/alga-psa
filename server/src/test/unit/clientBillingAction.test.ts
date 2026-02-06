import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClientContractLine, updateClientContractLine, getClientContractLine, getOverlappingBillings } from '@alga-psa/clients/actions/clientContractLineAction';
import { ClientContractLine } from '@alga-psa/billing/models';
import { IClientContractLine } from 'server/src/interfaces/billing.interfaces';
import { parseISO } from 'date-fns';

vi.mock('@alga-psa/clients/models/clientContractLine');
vi.mock('@/lib/db/db');

describe('Client Billing Actions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createClientContractLine', () => {
    it('should create a new client contract line when there are no overlaps', async () => {
      const newContractLine: Omit<IClientContractLine, 'client_contract_line_id'> = {
        client_id: 'client1',
        contract_line_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00.000Z',
        end_date: '2024-01-01T00:00:00.000Z',
        is_active: true,
        tenant: ''
      };

      const createdContractLine: IClientContractLine = { ...newContractLine, client_contract_line_id: 'billing1' };

      (ClientContractLine.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (ClientContractLine.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdContractLine);

      const result = await createClientContractLine(newContractLine);

      expect(result).toEqual(createdContractLine);
      expect(ClientContractLine.checkOverlappingBilling).toHaveBeenCalledWith(
        newContractLine.client_id,
        newContractLine.service_category,
        parseISO(newContractLine.start_date),
        parseISO(newContractLine.end_date!)
      );
      expect(ClientContractLine.create).toHaveBeenCalledWith(newContractLine);
    });

    it('should throw an error when there are overlapping billing entries', async () => {
      const newContractLine: Omit<IClientContractLine, 'client_contract_line_id'> = {
        client_id: 'client1',
        contract_line_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const overlappingContractLine: IClientContractLine = {
        ...newContractLine,
        client_contract_line_id: 'existing1',
        start_date: '2023-06-01T00:00:00Z',
        end_date: '2024-05-31T00:00:00Z',
      };

      (ClientContractLine.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([overlappingContractLine]);

      await expect(createClientContractLine(newContractLine)).rejects.toThrow(
        'Cannot create contract line: overlapping contract line exists for the same client and service category. Conflicting entry: ID existing1, Start Date: 2023-06-01, End Date: 2024-05-31'
      );
      expect(ClientContractLine.checkOverlappingBilling).toHaveBeenCalledWith(
        newContractLine.client_id,
        newContractLine.service_category,
        parseISO(newContractLine.start_date),
        parseISO(newContractLine.end_date!)
      );
      expect(ClientContractLine.create).not.toHaveBeenCalled();
    });
  });

  describe('updateClientContractLine', () => {
    it('should update a client contract line when there are no overlaps', async () => {
      const contractLineId = 'billing1';
      const updateData: Partial<IClientContractLine> = {
        end_date: '2024-01-01T00:00:00Z',
      };

      const existingContractLine: IClientContractLine = {
        client_contract_line_id: contractLineId,
        client_id: 'client1',
        contract_line_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const updatedContractLine: IClientContractLine = { ...existingContractLine, ...updateData };

      (ClientContractLine.getById as ReturnType<typeof vi.fn>).mockResolvedValue(existingContractLine);
      (ClientContractLine.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (ClientContractLine.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedContractLine);

      const result = await updateClientContractLine(contractLineId, updateData);

      expect(result).toEqual(updatedContractLine);
      expect(ClientContractLine.checkOverlappingBilling).toHaveBeenCalledWith(
        existingContractLine.client_id,
        existingContractLine.service_category,
        parseISO(existingContractLine.start_date),
        parseISO(updateData.end_date!),
        contractLineId
      );
      expect(ClientContractLine.update).toHaveBeenCalledWith(contractLineId, updateData);
    });

    it('should throw an error when updating creates an overlap', async () => {
      const contractLineId = 'billing1';
      const updateData: Partial<IClientContractLine> = {
        end_date: '2024-01-01T00:00:00Z',
      };

      const existingContractLine: IClientContractLine = {
        client_contract_line_id: contractLineId,
        client_id: 'client1',
        contract_line_id: 'plan1',
        service_category: 'category1',
        start_date: '2023-01-01T00:00:00Z',
        end_date: '2024-01-01T00:00:00Z',
        is_active: true,
        tenant: ''
      };

      const overlappingContractLine: IClientContractLine = {
        ...existingContractLine,
        client_contract_line_id: 'existing2',
        start_date: '2024-01-01T00:00:00Z',
        end_date: '2025-12-31T00:00:00Z',
      };

      (ClientContractLine.getById as ReturnType<typeof vi.fn>).mockResolvedValue(existingContractLine);
      (ClientContractLine.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue([overlappingContractLine]);

      await expect(updateClientContractLine(contractLineId, updateData)).rejects.toThrow(
        'Cannot update contract line: overlapping contract line exists for the same client and service category. Conflicting entry: ID existing2, Start Date: 2024-01-01, End Date: 2025-12-31'
      );
      expect(ClientContractLine.update).not.toHaveBeenCalled();
    });
  });

  describe('getClientContractLine', () => {
    it('should return client contract lines for a client', async () => {
      const clientId = 'client1';
      const mockContractLines: IClientContractLine[] = [
        {
          client_contract_line_id: 'billing1',
          client_id: clientId,
          contract_line_id: 'plan1',
          service_category: 'category1',
          start_date: '2023-01-01T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z',
          is_active: true,
          tenant: ''
        },
        {
          client_contract_line_id: 'billing2',
          client_id: clientId,
          contract_line_id: 'plan2',
          service_category: 'category2',
          start_date: '2023-01-01T00:00:00Z',
          end_date: null,
          is_active: true,
          tenant: ''
        }
      ];

      (ClientContractLine.getByClientId as ReturnType<typeof vi.fn>).mockResolvedValue(mockContractLines);

      const result = await getClientContractLine(clientId);

      expect(result).toEqual(mockContractLines);
      expect(ClientContractLine.getByClientId).toHaveBeenCalledWith(clientId);
    });

    it('should throw an error if fetching client contract lines fails', async () => {
      const clientId = 'client1';

      (ClientContractLine.getByClientId as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getClientContractLine(clientId)).rejects.toThrow('Failed to fetch client contract lines');
    });
  });

  describe('getOverlappingBillings', () => {
    it('should return overlapping contract line entries', async () => {
      const clientId = 'client1';
      const serviceCategory = 'category1';
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-12-31');
      const excludeContractLineId = 'billing1';

      const overlappingContractLines: IClientContractLine[] = [
        {
          client_contract_line_id: 'billing2',
          client_id: clientId,
          contract_line_id: 'plan2',
          service_category: serviceCategory,
          start_date: '2023-01-01T00:00:00Z',
          end_date: '2024-01-01T00:00:00Z',
          is_active: true,
          tenant: ''
        }
      ];

      (ClientContractLine.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockResolvedValue(overlappingContractLines);

      const result = await getOverlappingBillings(clientId, serviceCategory, startDate, endDate, excludeContractLineId);

      expect(result).toEqual(overlappingContractLines);
      expect(ClientContractLine.checkOverlappingBilling).toHaveBeenCalledWith(
        clientId,
        serviceCategory,
        startDate,
        endDate,
        excludeContractLineId
      );
    });

    it('should throw an error if checking for overlapping contract lines fails', async () => {
      const clientId = 'client1';
      const serviceCategory = 'category1';
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-12-31');

      (ClientContractLine.checkOverlappingBilling as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'));

      await expect(getOverlappingBillings(clientId, serviceCategory, startDate, endDate)).rejects.toThrow('Failed to check for overlapping contract lines');
    });
  });
});
