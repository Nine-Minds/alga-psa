import { describe, expect, it } from 'vitest';
import { CoManagedLifecycleError } from '@alga-psa/licensing/lifecycle';
import { ticketActionErrorFrom } from './ticketActionErrors';

describe('ticketActionErrorFrom with a co-managed lifecycle refusal', () => {
  it('returns the read-only message as an expected action error', () => {
    const error = new CoManagedLifecycleError({ state: 'terminated', canWrite: false, graceEndsAt: null });
    const result = ticketActionErrorFrom(error);
    expect(result).toMatchObject({ actionError: error.message });
    expect(error.message).toMatch(/read-only/i);
  });

  it('still rethrows errors it does not recognise', () => {
    expect(ticketActionErrorFrom(new Error('something unexpected'))).toBeNull();
  });
});
