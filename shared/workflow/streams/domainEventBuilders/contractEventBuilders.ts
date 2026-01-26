const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_CONTRACT_RENEWAL_UPCOMING_WINDOW_DAYS = 30;

function toUtcMidnightDate(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const trimmed = value.trim();
  const dateOnly = trimmed.includes('T') ? trimmed.slice(0, 10) : trimmed;
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

export function computeContractRenewalUpcoming(params: {
  renewalAt: string;
  now?: string | Date;
  windowDays?: number;
}): { renewalAt: string; daysUntilRenewal: number } | null {
  const windowDays = params.windowDays ?? DEFAULT_CONTRACT_RENEWAL_UPCOMING_WINDOW_DAYS;
  if (!Number.isInteger(windowDays) || windowDays < 0) return null;

  const renewalDate = toUtcMidnightDate(params.renewalAt);
  if (Number.isNaN(renewalDate.getTime())) return null;

  const nowDate = toUtcMidnightDate(params.now ?? new Date());
  const daysUntilRenewal = Math.round((renewalDate.getTime() - nowDate.getTime()) / MS_PER_DAY);

  if (!Number.isFinite(daysUntilRenewal) || daysUntilRenewal < 0) return null;
  if (daysUntilRenewal > windowDays) return null;

  return { renewalAt: params.renewalAt, daysUntilRenewal };
}

export function buildContractCreatedPayload(params: {
  contractId: string;
  clientId: string;
  createdByUserId?: string;
  createdAt?: string;
  startDate?: string;
  endDate?: string | null;
  status?: string;
}) {
  return {
    contractId: params.contractId,
    clientId: params.clientId,
    createdByUserId: params.createdByUserId,
    createdAt: params.createdAt,
    startDate: params.startDate,
    endDate: params.endDate ?? undefined,
    status: params.status,
  };
}

export function buildContractUpdatedPayload(params: {
  contractId: string;
  clientId: string;
  updatedAt?: string;
  updatedFields?: string[];
  changes?: Record<string, { previous: unknown; new: unknown }>;
}) {
  return {
    contractId: params.contractId,
    clientId: params.clientId,
    updatedAt: params.updatedAt,
    updatedFields: params.updatedFields,
    changes: params.changes,
  };
}

export function buildContractStatusChangedPayload(params: {
  contractId: string;
  clientId: string;
  previousStatus: string;
  newStatus: string;
  changedAt?: string;
}) {
  return {
    contractId: params.contractId,
    clientId: params.clientId,
    previousStatus: params.previousStatus,
    newStatus: params.newStatus,
    changedAt: params.changedAt,
  };
}

export function buildContractRenewalUpcomingPayload(params: {
  contractId: string;
  clientId: string;
  renewalAt: string;
  daysUntilRenewal: number;
}) {
  return {
    contractId: params.contractId,
    clientId: params.clientId,
    renewalAt: params.renewalAt,
    daysUntilRenewal: params.daysUntilRenewal,
  };
}

