import { describe, expect, it } from 'vitest';

import { contractWizardActionErrorFrom } from '../src/actions/contractWizardActionErrors';

describe('contractWizardActionErrorFrom', () => {
  it('converts missing currency pricing validation into a user-facing action error', () => {
    const message =
      'Cannot create contract in USD. The following services do not have USD pricing and no custom rate was entered: "Managed Service".';

    expect(contractWizardActionErrorFrom(new Error(message))).toEqual({
      actionError: message,
    });
  });

  it('leaves unknown errors unmapped so action callers rethrow them', () => {
    const unknown = new Error('Unexpected recurring period failure');
    const convertOrThrow = (error: unknown) => {
      const expected = contractWizardActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    };

    expect(() => convertOrThrow(unknown)).toThrow(unknown);
  });
});
