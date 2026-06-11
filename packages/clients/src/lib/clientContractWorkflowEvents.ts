import type { IClientContract } from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
import { deriveClientContractStatus } from '@alga-psa/shared/billingClients';

type ChangeRecord = Record<string, { previous: unknown; new: unknown }>;

function getDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  // pg returns date columns as Date objects; callers pass DB rows directly.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.includes('T') ? trimmed.slice(0, 10) : trimmed;
}

export function deriveClientContractWorkflowStatus(params: {
  isActive: boolean;
  startDate: string | Date;
  endDate: string | Date | null;
  now?: Temporal.PlainDate;
}): 'draft' | 'active' | 'terminated' | 'expired' {
  return deriveClientContractStatus({
    isActive: params.isActive,
    startDate: getDateOnly(params.startDate) ?? String(params.startDate),
    endDate: getDateOnly(params.endDate ?? undefined),
    now: (params.now ?? Temporal.Now.plainDateISO()).toString(),
  });
}

export function buildClientContractUpdatedFieldsAndChanges(params: {
  before: IClientContract;
  after: IClientContract;
}): { updatedFields: string[]; changes: ChangeRecord } {
  const updatedFields: string[] = [];
  const changes: ChangeRecord = {};

  const fieldMap: Array<{
    beforeKey: keyof IClientContract;
    afterKey: keyof IClientContract;
    field: string;
  }> = [
    { beforeKey: 'start_date', afterKey: 'start_date', field: 'startDate' },
    { beforeKey: 'end_date', afterKey: 'end_date', field: 'endDate' },
    { beforeKey: 'is_active', afterKey: 'is_active', field: 'isActive' },
    { beforeKey: 'po_required', afterKey: 'po_required', field: 'poRequired' },
    { beforeKey: 'po_number', afterKey: 'po_number', field: 'poNumber' },
    { beforeKey: 'po_amount', afterKey: 'po_amount', field: 'poAmount' },
  ];

  for (const mapping of fieldMap) {
    const previousValue = (params.before as any)[mapping.beforeKey];
    const newValue = (params.after as any)[mapping.afterKey];
    if (previousValue === newValue) continue;

    updatedFields.push(mapping.field);
    changes[mapping.field] = { previous: previousValue ?? null, new: newValue ?? null };
  }

  return { updatedFields, changes };
}
