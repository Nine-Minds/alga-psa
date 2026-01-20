import type { IClient, IClientContract } from '@alga-psa/types';

export interface BillingCycleDateRange {
  from?: string;
  to?: string;
}

export interface ClientPaginationParams {
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
  searchTerm?: string;
  clientTypeFilter?: 'all' | 'company' | 'individual';
  statusFilter?: 'all' | 'active' | 'inactive';
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  dateRange?: BillingCycleDateRange;
}

export interface PaginatedClientsResponse {
  clients: IClient[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type ClientContractAssignmentCreateInput = {
  client_id: string;
  contract_id: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  po_required?: boolean;
  po_number?: string | null;
  po_amount?: number | null;
};

export type ClientContractAssignmentUpdateInput = Partial<IClientContract>;

