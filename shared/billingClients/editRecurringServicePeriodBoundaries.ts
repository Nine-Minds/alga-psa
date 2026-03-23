import type {
  IRecurringActivityWindow,
  IRecurringDateRange,
  IRecurringServicePeriodRecord,
  ISO8601String,
} from '@alga-psa/types';
import {
  evaluateRecurringServicePeriodMutationPermission,
} from './recurringServicePeriodMutations';
import { validateRecurringServicePeriodEditContinuity } from './recurringServicePeriodEditValidation';
import { validateRecurringServicePeriodProvenance } from './recurringServicePeriodProvenance';

export interface EditRecurringServicePeriodBoundariesInput {
  record: IRecurringServicePeriodRecord;
  editedAt: ISO8601String;
  sourceRuleVersion: string;
  updatedServicePeriod?: IRecurringDateRange;
  updatedInvoiceWindow?: IRecurringDateRange;
  updatedActivityWindow?: IRecurringActivityWindow | null;
  siblingRecords?: IRecurringServicePeriodRecord[];
  sourceRunKey?: string | null;
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

export interface IRecurringServicePeriodBoundaryEditResult {
  supersededRecord: IRecurringServicePeriodRecord;
  editedRecord: IRecurringServicePeriodRecord;
}

function defaultRecordIdFactory(input: {
  scheduleKey: string;
  periodKey: string;
  revision: number;
}) {
  return `${input.scheduleKey}:${input.periodKey}:r${input.revision}`;
}

function compareDateOnly(left: ISO8601String, right: ISO8601String) {
  return left.slice(0, 10).localeCompare(right.slice(0, 10));
}

function validateRange(name: string, range: IRecurringDateRange) {
  if (range.semantics !== 'half_open') {
    throw new Error(`${name} must keep half_open semantics.`);
  }

  if (compareDateOnly(range.start, range.end) >= 0) {
    throw new Error(`${name} must have an end date after its start date.`);
  }
}

function validateActivityWindow(
  activityWindow: IRecurringActivityWindow | null | undefined,
  servicePeriod: IRecurringDateRange,
) {
  if (!activityWindow) {
    return;
  }

  if (activityWindow.semantics !== 'half_open') {
    throw new Error('activityWindow must keep half_open semantics.');
  }

  if (activityWindow.start && compareDateOnly(activityWindow.start, servicePeriod.start) < 0) {
    throw new Error('activityWindow.start cannot be before the service period start.');
  }

  if (activityWindow.end && compareDateOnly(activityWindow.end, servicePeriod.end) > 0) {
    throw new Error('activityWindow.end cannot be after the service period end.');
  }

  if (
    activityWindow.start
    && activityWindow.end
    && compareDateOnly(activityWindow.start, activityWindow.end) >= 0
  ) {
    throw new Error('activityWindow must have an end date after its start date.');
  }
}

function haveSameRange(left: IRecurringDateRange, right: IRecurringDateRange) {
  return left.start === right.start && left.end === right.end && left.semantics === right.semantics;
}

function haveSameActivityWindow(
  left: IRecurringActivityWindow | null | undefined,
  right: IRecurringActivityWindow | null | undefined,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function resolveReasonCode(input: {
  priorRecord: IRecurringServicePeriodRecord;
  servicePeriod: IRecurringDateRange;
  invoiceWindow: IRecurringDateRange;
  activityWindow: IRecurringActivityWindow | null | undefined;
}) {
  if (!haveSameRange(input.priorRecord.servicePeriod, input.servicePeriod)) {
    return 'boundary_adjustment' as const;
  }

  if (!haveSameRange(input.priorRecord.invoiceWindow, input.invoiceWindow)) {
    return 'invoice_window_adjustment' as const;
  }

  return 'activity_window_adjustment' as const;
}

export function editRecurringServicePeriodBoundaries(
  input: EditRecurringServicePeriodBoundariesInput,
): IRecurringServicePeriodBoundaryEditResult {
  const permission = evaluateRecurringServicePeriodMutationPermission(
    input.record,
    'edit_boundaries',
  );

  if (!permission.allowed) {
    throw new Error(permission.reason);
  }

  const servicePeriod = input.updatedServicePeriod ?? input.record.servicePeriod;
  const invoiceWindow = input.updatedInvoiceWindow ?? input.record.invoiceWindow;
  const activityWindow = input.updatedActivityWindow === undefined
    ? input.record.activityWindow
    : input.updatedActivityWindow;

  validateRange('servicePeriod', servicePeriod);
  validateRange('invoiceWindow', invoiceWindow);
  validateActivityWindow(activityWindow, servicePeriod);

  if (
    haveSameRange(servicePeriod, input.record.servicePeriod)
    && haveSameRange(invoiceWindow, input.record.invoiceWindow)
    && haveSameActivityWindow(activityWindow, input.record.activityWindow)
  ) {
    throw new Error('Boundary adjustment must change at least one persisted boundary.');
  }

  const revision = input.record.revision + 1;
  const recordIdFactory = input.recordIdFactory ?? defaultRecordIdFactory;
  const editedRecord: IRecurringServicePeriodRecord = {
    ...input.record,
    recordId: recordIdFactory({
      scheduleKey: input.record.scheduleKey,
      periodKey: input.record.periodKey,
      revision,
    }),
    revision,
    lifecycleState: 'edited',
    servicePeriod,
    invoiceWindow,
    activityWindow,
    provenance: {
      kind: 'user_edited',
      reasonCode: resolveReasonCode({
        priorRecord: input.record,
        servicePeriod,
        invoiceWindow,
        activityWindow,
      }),
      sourceRuleVersion: input.sourceRuleVersion,
      sourceRunKey: input.sourceRunKey ?? null,
      supersedesRecordId: input.record.recordId,
    },
    invoiceLinkage: null,
    createdAt: input.editedAt,
    updatedAt: input.editedAt,
  };

  const provenanceValidation = validateRecurringServicePeriodProvenance(editedRecord.provenance);
  if (!provenanceValidation.valid) {
    throw new Error(provenanceValidation.errors.join(' '));
  }

  if (input.siblingRecords?.length) {
    const continuityValidation = validateRecurringServicePeriodEditContinuity({
      editedRecord,
      siblingRecords: input.siblingRecords,
      supersededRecordId: input.record.recordId,
    });
    if (!continuityValidation.valid) {
      throw new Error(continuityValidation.errors.join(' '));
    }
  }

  return {
    supersededRecord: {
      ...input.record,
      lifecycleState: 'superseded',
      updatedAt: input.editedAt,
    },
    editedRecord,
  };
}
