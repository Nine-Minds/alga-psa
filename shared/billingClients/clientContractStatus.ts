import type { ContractStatus } from '@alga-psa/types';

export type ClientAssignmentStatus = Extract<
  ContractStatus,
  'draft' | 'active' | 'terminated' | 'expired'
>;

type DeriveClientContractStatusParams = {
  isActive: boolean;
  startDate: string | Date | null | undefined;
  endDate: string | Date | null | undefined;
  contractStatus?: string;
  now?: string | Date;
};

const normalizeDateOnly = (value: string | Date | null | undefined): string | null => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed.includes('T') ? trimmed.slice(0, 10) : null;
};

const normalizeNowDateOnly = (value?: string | Date): string => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const normalized = normalizeDateOnly(value);
  if (normalized) {
    return normalized;
  }

  return new Date().toISOString().slice(0, 10);
};

export function deriveClientContractStatus(
  params: DeriveClientContractStatusParams
): ClientAssignmentStatus {
  if (params.contractStatus === 'draft') {
    return 'draft';
  }

  const startDate = normalizeDateOnly(params.startDate);
  const endDate = normalizeDateOnly(params.endDate);
  const nowDate = normalizeNowDateOnly(params.now);

  if (startDate && startDate > nowDate) {
    return 'draft';
  }

  if (!params.isActive) {
    return 'terminated';
  }

  if (endDate && endDate < nowDate) {
    return 'expired';
  }

  return 'active';
}

export function isLiveClientContractStatus(status: ClientAssignmentStatus): boolean {
  return status === 'active' || status === 'expired' || status === 'terminated';
}
