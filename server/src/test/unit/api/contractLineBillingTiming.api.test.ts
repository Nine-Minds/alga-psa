import { describe, expect, it } from 'vitest';
import { handleApiError } from '@/lib/api/middleware/apiMiddleware';
import {
  createContractLineSchema,
  updateContractLineSchema,
} from 'server/src/lib/api/schemas/contractLineSchemas';
import { resolveRecurringAuthoringPolicy } from '@shared/billingClients/recurringAuthoringPolicy';
import {
  CONTRACT_LINE_TIMING_NOT_ALLOWED_MESSAGE,
  ContractLineTimingNotAllowedError,
} from '@shared/billingClients/contractLineTimingRule';

const base = { contract_line_name: 'Support', billing_frequency: 'monthly' };

describe('REST contract line billing_timing (alga-2026-0002697)', () => {
  it('create/update schemas keep billing_timing instead of silently dropping it', () => {
    const created = createContractLineSchema.parse({ ...base, contract_line_type: 'Hourly', billing_timing: 'advance' });
    expect(created.billing_timing).toBe('advance');
    expect(updateContractLineSchema.parse({ billing_timing: 'arrears' }).billing_timing).toBe('arrears');
    expect(createContractLineSchema.safeParse({ ...base, contract_line_type: 'Fixed', billing_timing: 'sometime' }).success).toBe(false);
    expect(createContractLineSchema.parse({ ...base, contract_line_type: 'Fixed' }).billing_timing).toBeUndefined();
  });

  it.each(['Hourly', 'Usage'])('an advance %s write is rejected by the authoring policy', (lineType) => {
    expect(() => resolveRecurringAuthoringPolicy({ lineType, cadenceOwner: 'client', billingTiming: 'advance' } as any))
      .toThrow(CONTRACT_LINE_TIMING_NOT_ALLOWED_MESSAGE);
    // An absent or arrears value is fine and resolves to arrears.
    expect(resolveRecurringAuthoringPolicy({ lineType, cadenceOwner: 'client' } as any).billingTiming).toBe('arrears');
  });

  it('the rejection reaches the client as 400 with the rule message, not 500', async () => {
    const response = handleApiError(new ContractLineTimingNotAllowedError());
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('CONTRACT_LINE_TIMING_NOT_ALLOWED');
    expect(body.error.message).toBe(CONTRACT_LINE_TIMING_NOT_ALLOWED_MESSAGE);
  });
});
