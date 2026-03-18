import type {
  IRecurringServicePeriodEditFailure,
  IRecurringServicePeriodEditRequest,
  IRecurringServicePeriodEditRequestContext,
  IRecurringServicePeriodEditResponse,
  IRecurringServicePeriodEditSuccess,
  IRecurringServicePeriodEditValidationIssue,
  IRecurringServicePeriodRecord,
} from '@alga-psa/types';
import { editRecurringServicePeriodBoundaries } from './editRecurringServicePeriodBoundaries';
import { skipOrDeferRecurringServicePeriod } from './skipOrDeferRecurringServicePeriod';

export interface ApplyRecurringServicePeriodEditRequestInput {
  record: IRecurringServicePeriodRecord;
  request: IRecurringServicePeriodEditRequest;
  context: IRecurringServicePeriodEditRequestContext;
  siblingRecords?: IRecurringServicePeriodRecord[];
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

function failureResponse(input: {
  request: IRecurringServicePeriodEditRequest;
  validationIssues: IRecurringServicePeriodEditValidationIssue[];
}): IRecurringServicePeriodEditFailure {
  return {
    ok: false,
    operation: input.request.operation,
    recordId: input.request.recordId,
    validationIssues: input.validationIssues,
  };
}

function successResponse(input: {
  request: IRecurringServicePeriodEditRequest;
  supersededRecord: IRecurringServicePeriodRecord;
  editedRecord: IRecurringServicePeriodRecord;
}): IRecurringServicePeriodEditSuccess {
  return {
    ok: true,
    operation: input.request.operation,
    recordId: input.request.recordId,
    supersededRecord: input.supersededRecord,
    editedRecord: input.editedRecord,
    provenance: input.editedRecord.provenance,
    validationIssues: [],
  };
}

function extractContinuityIssues(
  message: string,
): IRecurringServicePeriodEditValidationIssue[] {
  const matches = Array.from(
    message.matchAll(/Edit would create a service-period (gap|overlap) (before|after) [^.]+\./g),
  );

  return matches.map((match) => {
    const relation = `${match[1]}_${match[2]}` as
      | 'gap_before'
      | 'overlap_before'
      | 'gap_after'
      | 'overlap_after';

    const code = {
      gap_before: 'continuity_gap_before',
      overlap_before: 'continuity_overlap_before',
      gap_after: 'continuity_gap_after',
      overlap_after: 'continuity_overlap_after',
    }[relation] as IRecurringServicePeriodEditValidationIssue['code'];

    return {
      code,
      field: 'servicePeriod',
      message: match[0],
    };
  });
}

function mapRecurringServicePeriodEditError(
  error: unknown,
): IRecurringServicePeriodEditValidationIssue[] {
  const message = error instanceof Error ? error.message : String(error);
  const continuityIssues = extractContinuityIssues(message);
  if (continuityIssues.length > 0) {
    return continuityIssues;
  }

  if (message.startsWith('Record mismatch: request targets')) {
    return [{
      code: 'record_mismatch',
      field: 'recordId',
      message,
    }];
  }

  if (message.startsWith('Locked or billed service periods cannot be edited')) {
    return [{
      code: 'immutable_record',
      field: 'operation',
      message,
    }];
  }

  if (message === 'Boundary adjustment must change at least one persisted boundary.') {
    return [{
      code: 'no_changes',
      field: 'operation',
      message,
    }];
  }

  if (
    message.startsWith('servicePeriod must keep half_open semantics.')
    || message.startsWith('servicePeriod must have an end date after its start date.')
  ) {
    return [{
      code: 'invalid_service_period_range',
      field: 'servicePeriod',
      message,
    }];
  }

  if (
    message.startsWith('invoiceWindow must keep half_open semantics.')
    || message.startsWith('invoiceWindow must have an end date after its start date.')
  ) {
    return [{
      code: 'invalid_invoice_window_range',
      field: 'invoiceWindow',
      message,
    }];
  }

  if (
    message.startsWith('activityWindow must keep half_open semantics.')
    || message.startsWith('activityWindow.start cannot be before the service period start.')
    || message.startsWith('activityWindow.end cannot be after the service period end.')
    || message.startsWith('activityWindow must have an end date after its start date.')
  ) {
    return [{
      code: 'invalid_activity_window_range',
      field: 'activityWindow',
      message,
    }];
  }

  if (message === 'Deferring a service period requires an explicit deferred invoice window.') {
    return [{
      code: 'missing_deferred_invoice_window',
      field: 'deferredInvoiceWindow',
      message,
    }];
  }

  if (
    message === 'Deferred invoice window must keep half_open semantics.'
    || message === 'Deferred invoice window must have an end date after its start date.'
  ) {
    return [{
      code: 'invalid_deferred_invoice_window',
      field: 'deferredInvoiceWindow',
      message,
    }];
  }

  if (message === 'Defer operation must move the invoice window.') {
    return [{
      code: 'unchanged_deferred_invoice_window',
      field: 'deferredInvoiceWindow',
      message,
    }];
  }

  return [{
    code: 'unknown_validation_error',
    field: 'operation',
    message,
  }];
}

export function applyRecurringServicePeriodEditRequest(
  input: ApplyRecurringServicePeriodEditRequestInput,
): IRecurringServicePeriodEditResponse {
  if (input.request.recordId !== input.record.recordId) {
    return failureResponse({
      request: input.request,
      validationIssues: mapRecurringServicePeriodEditError(
        new Error(
          `Record mismatch: request targets ${input.request.recordId} but loaded record is ${input.record.recordId}.`,
        ),
      ),
    });
  }

  try {
    switch (input.request.operation) {
      case 'boundary_adjustment': {
        const result = editRecurringServicePeriodBoundaries({
          record: input.record,
          editedAt: input.context.editedAt,
          sourceRuleVersion: input.context.sourceRuleVersion,
          sourceRunKey: input.context.sourceRunKey ?? null,
          siblingRecords: input.siblingRecords,
          recordIdFactory: input.recordIdFactory,
          updatedServicePeriod: input.request.updatedServicePeriod,
          updatedInvoiceWindow: input.request.updatedInvoiceWindow,
          updatedActivityWindow: input.request.updatedActivityWindow,
        });

        return successResponse({
          request: input.request,
          supersededRecord: result.supersededRecord,
          editedRecord: result.editedRecord,
        });
      }
      case 'skip':
      case 'defer': {
        const result = skipOrDeferRecurringServicePeriod({
          record: input.record,
          operation: input.request.operation,
          editedAt: input.context.editedAt,
          sourceRuleVersion: input.context.sourceRuleVersion,
          sourceRunKey: input.context.sourceRunKey ?? null,
          siblingRecords: input.siblingRecords,
          recordIdFactory: input.recordIdFactory,
          deferredInvoiceWindow: input.request.operation === 'defer'
            ? input.request.deferredInvoiceWindow
            : undefined,
        });

        return successResponse({
          request: input.request,
          supersededRecord: result.supersededRecord,
          editedRecord: result.editedRecord,
        });
      }
    }
  } catch (error) {
    return failureResponse({
      request: input.request,
      validationIssues: mapRecurringServicePeriodEditError(error),
    });
  }
}
