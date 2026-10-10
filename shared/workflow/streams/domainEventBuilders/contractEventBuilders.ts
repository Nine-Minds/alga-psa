const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_CONTRACT_RENEWAL_UPCOMING_WINDOW_DAYS = 90;

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
  decisionDueAt?: string;
  renewalCycleKey?: string;
  now?: string | Date;
  windowDays?: number;
}): {
  renewalAt: string;
  decisionDueDate: string;
  daysUntilRenewal: number;
  daysUntilDecisionDue: number;
  renewalCycleKey?: string;
} | null {
  const windowDays = params.windowDays ?? DEFAULT_CONTRACT_RENEWAL_UPCOMING_WINDOW_DAYS;
  if (!Number.isInteger(windowDays) || windowDays < 0) return null;

  const renewalDate = toUtcMidnightDate(params.renewalAt);
  if (Number.isNaN(renewalDate.getTime())) return null;
  const decisionDueDateRaw = params.decisionDueAt ?? params.renewalAt;
  const decisionDueDate = toUtcMidnightDate(decisionDueDateRaw);
  if (Number.isNaN(decisionDueDate.getTime())) return null;

  const nowDate = toUtcMidnightDate(params.now ?? new Date());
  const daysUntilDecisionDue = Math.round((decisionDueDate.getTime() - nowDate.getTime()) / MS_PER_DAY);
  const daysUntilRenewal = Math.round((renewalDate.getTime() - nowDate.getTime()) / MS_PER_DAY);

  if (!Number.isFinite(daysUntilDecisionDue) || daysUntilDecisionDue < 0) return null;
  if (!Number.isFinite(daysUntilRenewal)) return null;
  if (daysUntilDecisionDue > windowDays) return null;

  return {
    renewalAt: params.renewalAt,
    decisionDueDate: decisionDueDateRaw,
    daysUntilRenewal,
    daysUntilDecisionDue,
    renewalCycleKey: params.renewalCycleKey,
  };
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
  decisionDueDate?: string;
  daysUntilRenewal: number;
  daysUntilDecisionDue?: number;
  renewalCycleKey?: string;
}) {
  return {
    contractId: params.contractId,
    clientId: params.clientId,
    renewalAt: params.renewalAt,
    decisionDueDate: params.decisionDueDate,
    daysUntilRenewal: params.daysUntilRenewal,
    daysUntilDecisionDue: params.daysUntilDecisionDue,
    renewalCycleKey: params.renewalCycleKey,
  };
}

/**
 * CONTRACT_CREATED for the contract-record actions (billing `createContract`), as opposed to the
 * client-assignment flows above. `clientId` is the contract's owner client; a contract with no
 * owner has no client to name. Legacy `userId`/`timestamp` are kept for existing consumers.
 */
export function buildContractRecordCreatedPayload(params: {
  contractId: string;
  ownerClientId?: string | null;
  userId?: string;
  occurredAt: string;
  status?: string;
}) {
  return {
    contractId: params.contractId,
    ...(params.ownerClientId ? { clientId: params.ownerClientId } : {}),
    createdByUserId: params.userId,
    createdAt: params.occurredAt,
    status: params.status,
    userId: params.userId,
    timestamp: params.occurredAt,
  };
}

/**
 * CONTRACT_UPDATED for the contract-record actions. `changes` is the schema's `{previous, new}`
 * map (the action used to send the raw update patch), derived from the stored before/after rows.
 */
export function buildContractRecordUpdatedPayload(params: {
  contractId: string;
  ownerClientId?: string | null;
  userId?: string;
  occurredAt: string;
  status?: string;
  patch: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const changes: Record<string, { previous: unknown; new: unknown }> = {};
  for (const key of Object.keys(params.patch)) {
    const previous = params.before[key];
    const next = params.after[key];
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes[key] = { previous: previous ?? null, new: next ?? null };
    }
  }
  return {
    contractId: params.contractId,
    ...(params.ownerClientId ? { clientId: params.ownerClientId } : {}),
    updatedAt: params.occurredAt,
    updatedFields: Object.keys(changes),
    changes,
    status: params.status,
    userId: params.userId,
    timestamp: params.occurredAt,
  };
}
