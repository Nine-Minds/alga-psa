import type {
  IRecurringDateRange,
  IRecurringServicePeriodRecord,
  ISO8601String,
} from '@alga-psa/types';
import { evaluateRecurringServicePeriodMutationPermission } from './recurringServicePeriodMutations';
import { validateRecurringServicePeriodEditContinuity } from './recurringServicePeriodEditValidation';
import { validateRecurringServicePeriodProvenance } from './recurringServicePeriodProvenance';

export interface SkipOrDeferRecurringServicePeriodInput {
  record: IRecurringServicePeriodRecord;
  operation: 'skip' | 'defer';
  editedAt: ISO8601String;
  sourceRuleVersion: string;
  deferredInvoiceWindow?: IRecurringDateRange;
  siblingRecords?: IRecurringServicePeriodRecord[];
  sourceRunKey?: string | null;
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

export interface IRecurringServicePeriodDispositionEditResult {
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

function validateDeferredInvoiceWindow(range: IRecurringDateRange) {
  if (range.semantics !== 'half_open') {
    throw new Error('Deferred invoice window must keep half_open semantics.');
  }
  if (compareDateOnly(range.start, range.end) >= 0) {
    throw new Error('Deferred invoice window must have an end date after its start date.');
  }
}

export function skipOrDeferRecurringServicePeriod(
  input: SkipOrDeferRecurringServicePeriodInput,
): IRecurringServicePeriodDispositionEditResult {
  const permission = evaluateRecurringServicePeriodMutationPermission(
    input.record,
    input.operation,
  );

  if (!permission.allowed) {
    throw new Error(permission.reason);
  }

  let lifecycleState: IRecurringServicePeriodRecord['lifecycleState'];
  let invoiceWindow = input.record.invoiceWindow;
  let reasonCode: 'skip' | 'defer';

  if (input.operation === 'skip') {
    lifecycleState = 'skipped';
    reasonCode = 'skip';
  } else {
    if (!input.deferredInvoiceWindow) {
      throw new Error('Deferring a service period requires an explicit deferred invoice window.');
    }
    validateDeferredInvoiceWindow(input.deferredInvoiceWindow);
    if (
      input.deferredInvoiceWindow.start === input.record.invoiceWindow.start
      && input.deferredInvoiceWindow.end === input.record.invoiceWindow.end
      && input.deferredInvoiceWindow.semantics === input.record.invoiceWindow.semantics
    ) {
      throw new Error('Defer operation must move the invoice window.');
    }

    lifecycleState = 'edited';
    invoiceWindow = input.deferredInvoiceWindow;
    reasonCode = 'defer';
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
    lifecycleState,
    invoiceWindow,
    provenance: {
      kind: 'user_edited',
      reasonCode,
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
