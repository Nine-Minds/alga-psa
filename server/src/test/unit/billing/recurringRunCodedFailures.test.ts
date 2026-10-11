import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionError } from '@alga-psa/ui/lib/errorHandling';
import { invoiceGenerationActionErrorFrom } from '../../../../../packages/billing/src/actions/invoiceGenerationActionErrors';
import {
  handledRecurringFailureFromActionError,
  recurringRunFailureFromThrown,
} from '../../../../../packages/billing/src/actions/recurringBillingRunFailure';
import {
  NO_ACTIVE_CONTRACT_LINES_MESSAGE_KEY,
  NOTHING_TO_BILL_MESSAGE_KEY,
  RECURRING_PERIODS_NOT_MATERIALIZED_MESSAGE_KEY,
} from '../../../../../packages/billing/src/actions/invoiceGeneration.constants';

afterEach(() => {
  vi.restoreAllMocks();
});

const ENGINE_SENTENCES = [
  {
    sentence: 'Recurring service periods were not materialized for client c in window w.',
    key: RECURRING_PERIODS_NOT_MATERIALIZED_MESSAGE_KEY,
    code: 'RECURRING_PERIODS_NOT_MATERIALIZED',
  },
  {
    sentence: 'No active contract lines found for this client in the selected billing period.',
    key: NO_ACTIVE_CONTRACT_LINES_MESSAGE_KEY,
    code: 'NO_ACTIVE_CONTRACT_LINES',
  },
  { sentence: 'Nothing to bill', key: NOTHING_TO_BILL_MESSAGE_KEY, code: 'NOTHING_TO_BILL' },
] as const;

describe('invoiceGenerationActionErrorFrom: explained engine refusals', () => {
  it.each(ENGINE_SENTENCES)('maps "$sentence" to a keyed action error', ({ sentence, key }) => {
    const mapped = invoiceGenerationActionErrorFrom(new Error(sentence)) as {
      actionError: string;
      messageKey?: string;
    };
    expect(mapped.messageKey).toBe(key);
    // Actionable English, not the raw engine sentence.
    expect(mapped.actionError).not.toBe(sentence);
    expect(mapped.actionError.length).toBeGreaterThan(20);
  });

  it('does not map an arbitrary exception', () => {
    expect(invoiceGenerationActionErrorFrom(new Error('boom'))).toBeNull();
  });
});

describe('handledRecurringFailureFromActionError', () => {
  it.each(ENGINE_SENTENCES)('maps $key to $code', ({ key, code }) => {
    expect(handledRecurringFailureFromActionError(actionError('x', key) as any)).toEqual({ code });
  });
});

describe('recurringRunFailureFromThrown', () => {
  const ctx = {
    runId: 'run-1',
    tenantId: 'tenant-1',
    billingCycleId: 'cycle-1',
    executionIdentityKey: 'identity-1',
    executionWindowKind: 'client_cadence_window' as const,
  };

  it('turns an unmapped error into UNEXPECTED with a ref that is logged and never leaks the cause', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const failure = recurringRunFailureFromThrown(new Error('secret db detail'), ctx);

    expect(failure.code).toBe('UNEXPECTED');
    const ref = failure.params?.ref as string;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(failure.errorMessage).toContain(ref);
    expect(failure.errorMessage).not.toContain('secret db detail');
    expect(failure.errorMessage).not.toContain('Failed to generate invoice for this billing cycle');
    expect(spy.mock.calls[0][1]).toMatchObject({ ref, runId: 'run-1' });
  });

  it('reports a mapped engine refusal with its code', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const failure = recurringRunFailureFromThrown(
      new Error('Recurring service periods were not materialized for client c.'),
      ctx,
    );

    expect(failure.code).toBe('RECURRING_PERIODS_NOT_MATERIALIZED');
    expect(failure.params).toBeUndefined();
  });
});
