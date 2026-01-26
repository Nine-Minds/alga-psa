import type { IClientContract } from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate } from '@alga-psa/core';

type ChangeRecord = Record<string, { previous: unknown; new: unknown }>;

function getDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.includes('T') ? trimmed.slice(0, 10) : trimmed;
}

export function deriveClientContractWorkflowStatus(params: {
  isActive: boolean;
  startDate: string;
  endDate: string | null;
  now?: Temporal.PlainDate;
}): 'draft' | 'active' | 'terminated' | 'expired' {
  const now = params.now ?? Temporal.Now.plainDateISO();
  const startDateOnly = getDateOnly(params.startDate) ?? params.startDate;
  const endDateOnly = getDateOnly(params.endDate ?? undefined);

  const start = toPlainDate(startDateOnly);
  const end = endDateOnly ? toPlainDate(endDateOnly) : null;

  if (!params.isActive) {
    return Temporal.PlainDate.compare(start, now) > 0 ? 'draft' : 'terminated';
  }

  if (end && Temporal.PlainDate.compare(end, now) < 0) {
    return 'expired';
  }

  return 'active';
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

