import type {
  IRecurringServicePeriodListingQuery,
  IRecurringServicePeriodOperationalView,
  IRecurringServicePeriodOperationalViewSummary,
  IRecurringServicePeriodRecord,
  RecurringServicePeriodLifecycleState,
} from '@alga-psa/types';

import { getRecurringServicePeriodDisplayState } from './recurringServicePeriodDisplayState';
import { listRecurringServicePeriodRecords } from './recurringServicePeriodListing';

const EXCEPTION_LIFECYCLE_STATES = new Set<RecurringServicePeriodLifecycleState>([
  'edited',
  'skipped',
  'locked',
]);

function buildOperationalSummary(
  rows: IRecurringServicePeriodOperationalView['rows'],
): IRecurringServicePeriodOperationalViewSummary {
  return rows.reduce<IRecurringServicePeriodOperationalViewSummary>(
    (summary, row) => {
      summary.totalRows += 1;

      if (row.isException) {
        summary.exceptionRows += 1;
      }

      switch (row.displayState.lifecycleState) {
        case 'generated':
          summary.generatedRows += 1;
          break;
        case 'edited':
          summary.editedRows += 1;
          break;
        case 'skipped':
          summary.skippedRows += 1;
          break;
        case 'locked':
          summary.lockedRows += 1;
          break;
        default:
          break;
      }

      return summary;
    },
    {
      totalRows: 0,
      exceptionRows: 0,
      generatedRows: 0,
      editedRows: 0,
      skippedRows: 0,
      lockedRows: 0,
    },
  );
}

export function buildRecurringServicePeriodOperationalView(input: {
  records: IRecurringServicePeriodRecord[];
  query: IRecurringServicePeriodListingQuery;
}): IRecurringServicePeriodOperationalView {
  const rows = listRecurringServicePeriodRecords(input.records, input.query).map((record) => {
    const displayState = getRecurringServicePeriodDisplayState(record);

    return {
      recordId: record.recordId,
      scheduleKey: record.scheduleKey,
      revision: record.revision,
      cadenceOwner: record.cadenceOwner,
      duePosition: record.duePosition,
      sourceObligation: record.sourceObligation,
      chargeFamily: record.sourceObligation.chargeFamily,
      servicePeriod: record.servicePeriod,
      invoiceWindow: record.invoiceWindow,
      activityWindow: record.activityWindow,
      displayState,
      isException: EXCEPTION_LIFECYCLE_STATES.has(record.lifecycleState),
    };
  });

  return {
    query: input.query,
    summary: buildOperationalSummary(rows),
    rows,
  };
}
