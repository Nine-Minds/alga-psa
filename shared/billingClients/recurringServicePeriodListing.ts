import type {
  IRecurringServicePeriodListingQuery,
  IRecurringServicePeriodRecord,
  RecurringChargeFamily,
  RecurringServicePeriodListingState,
} from '@alga-psa/types';
import { DEFAULT_RECURRING_SERVICE_PERIOD_LISTING_STATES } from '@alga-psa/types';

export function buildRecurringServicePeriodListingQuery(input: {
  tenant: string;
  asOf: string;
  scheduleKeys?: string[];
  cadenceOwner?: IRecurringServicePeriodListingQuery['cadenceOwner'];
  duePosition?: IRecurringServicePeriodListingQuery['duePosition'];
  lifecycleStates?: RecurringServicePeriodListingState[];
  chargeFamilies?: RecurringChargeFamily[];
}): IRecurringServicePeriodListingQuery {
  return {
    tenant: input.tenant,
    asOf: input.asOf,
    scheduleKeys: input.scheduleKeys ? Array.from(new Set(input.scheduleKeys.filter(Boolean))).sort() : undefined,
    cadenceOwner: input.cadenceOwner,
    duePosition: input.duePosition,
    lifecycleStates: [...(input.lifecycleStates ?? DEFAULT_RECURRING_SERVICE_PERIOD_LISTING_STATES)],
    chargeFamilies: input.chargeFamilies ? [...input.chargeFamilies] : undefined,
  };
}

export function listRecurringServicePeriodRecords(
  records: IRecurringServicePeriodRecord[],
  query: IRecurringServicePeriodListingQuery,
) {
  return records
    .filter((record) =>
      record.sourceObligation.tenant === query.tenant
      && record.servicePeriod.end > query.asOf
      && query.lifecycleStates.includes(record.lifecycleState as RecurringServicePeriodListingState)
      && (!query.scheduleKeys || query.scheduleKeys.includes(record.scheduleKey))
      && (!query.cadenceOwner || record.cadenceOwner === query.cadenceOwner)
      && (!query.duePosition || record.duePosition === query.duePosition)
      && (!query.chargeFamilies || query.chargeFamilies.includes(record.sourceObligation.chargeFamily))
    )
    .sort((left, right) => {
      if (left.servicePeriod.start !== right.servicePeriod.start) {
        return left.servicePeriod.start.localeCompare(right.servicePeriod.start);
      }
      if (left.servicePeriod.end !== right.servicePeriod.end) {
        return left.servicePeriod.end.localeCompare(right.servicePeriod.end);
      }
      if (left.sourceObligation.obligationId !== right.sourceObligation.obligationId) {
        return left.sourceObligation.obligationId.localeCompare(right.sourceObligation.obligationId);
      }
      return left.revision - right.revision;
    });
}
