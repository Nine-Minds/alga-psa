import { describe, expect, it } from 'vitest';
import { BundleAuthorizationKernelProvider } from './bundleProvider';
import type { AuthorizationEvaluationInput } from '../contracts';

const input = (action: string): AuthorizationEvaluationInput => ({
  subject: { tenant: 't1', userId: 'u1', userType: 'internal' },
  resource: { type: 'asset', action, id: 'a1' },
  record: { id: 'a1', is_client_visible: false },
} as AuthorizationEvaluationInput);

describe('asset bundle action matching', () => {
  it('applies only the exact resource and action rule, and leaves a missing action rule un-narrowed', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [
        { id: 'asset-read', resource: 'asset', action: 'read', constraintKey: 'client_visible_only' },
      ],
    });

    const read = await provider.evaluateNarrowing(input('read'));
    const deletion = await provider.evaluateNarrowing(input('delete'));

    expect(read.scope.denied).toBe(true);
    expect(read.reasons.map((reason) => reason.code)).toContain('client_visible_only_denied');
    expect(deletion.scope.allowAll).toBe(true);
    expect(deletion.reasons).toEqual([]);
  });
});
