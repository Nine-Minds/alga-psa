import { describe, expect, it } from 'vitest';

import { getRecurringServicePeriodDisplayState } from '@alga-psa/shared/billingClients/recurringServicePeriodDisplayState';
import {
  buildRecurringServicePeriodInvoiceLinkage,
  buildRecurringServicePeriodRecord,
} from '../../test-utils/recurringTimingFixtures';

describe('recurring service period display state', () => {
  it('T302: service-period UI states clearly differentiate generated, edited, skipped, locked, billed, and superseded periods', () => {
    expect(
      getRecurringServicePeriodDisplayState(
        buildRecurringServicePeriodRecord({
          lifecycleState: 'generated',
          provenance: {
            kind: 'generated',
            sourceRuleVersion: 'line-1:v1',
            reasonCode: 'initial_materialization',
            sourceRunKey: 'materialize-1',
          },
        }),
      ),
    ).toEqual({
      lifecycleState: 'generated',
      label: 'Generated',
      tone: 'neutral',
      detail: 'Matches the current cadence rules and is awaiting billing or review.',
      reasonLabel: 'Generated from source cadence',
    });

    expect(
      getRecurringServicePeriodDisplayState(
        buildRecurringServicePeriodRecord({
          lifecycleState: 'edited',
          provenance: {
            kind: 'user_edited',
            sourceRuleVersion: 'line-1:v2',
            reasonCode: 'defer',
            sourceRunKey: 'edit-1',
            supersedesRecordId: 'rsp_prev',
          },
        }),
      ),
    ).toMatchObject({
      label: 'Edited',
      tone: 'accent',
      reasonLabel: 'Deferred to a later invoice window',
    });

    expect(
      getRecurringServicePeriodDisplayState(
        buildRecurringServicePeriodRecord({
          lifecycleState: 'skipped',
          provenance: {
            kind: 'user_edited',
            sourceRuleVersion: 'line-1:v2',
            reasonCode: 'skip',
            sourceRunKey: 'skip-1',
            supersedesRecordId: 'rsp_prev',
          },
        }),
      ),
    ).toMatchObject({
      label: 'Skipped',
      tone: 'warning',
      reasonLabel: 'Skipped by billing staff',
    });

    expect(
      getRecurringServicePeriodDisplayState(
        buildRecurringServicePeriodRecord({
          lifecycleState: 'locked',
        }),
      ),
    ).toMatchObject({
      label: 'Locked',
      tone: 'warning',
    });

    expect(
      getRecurringServicePeriodDisplayState(
        buildRecurringServicePeriodRecord({
          lifecycleState: 'billed',
          invoiceLinkage: buildRecurringServicePeriodInvoiceLinkage({
            invoiceChargeDetailId: 'detail-42',
          }),
        }),
      ),
    ).toEqual({
      lifecycleState: 'billed',
      label: 'Billed',
      tone: 'success',
      detail: 'Linked to invoice detail detail-42.',
      reasonLabel: 'Generated from source cadence',
    });

    expect(
      getRecurringServicePeriodDisplayState(
        buildRecurringServicePeriodRecord({
          lifecycleState: 'superseded',
        }),
      ),
    ).toEqual({
      lifecycleState: 'superseded',
      label: 'Superseded',
      tone: 'muted',
      detail: 'A newer revision replaced this period and this row remains for audit history.',
      reasonLabel: 'Generated from source cadence',
    });
  });
});
