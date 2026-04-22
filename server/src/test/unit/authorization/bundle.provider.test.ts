import { describe, expect, it } from 'vitest';

import { BundleAuthorizationKernelProvider } from 'server/src/lib/authorization/kernel';

describe('bundle authorization provider constraints', () => {
  it('denies resource access when client_visible_only constraint is violated', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [
        {
          id: 'rule-1',
          resource: 'document',
          action: 'read',
          constraintKey: 'client_visible_only',
        },
      ],
    });

    const result = await provider.evaluateNarrowing({
      subject: {
        tenant: 'tenant-a',
        userId: 'user-a',
        userType: 'client',
      },
      resource: {
        type: 'document',
        action: 'read',
      },
      record: {
        id: 'doc-1',
        is_client_visible: false,
      },
    });

    expect(result.scope.denied).toBe(true);
    expect(result.reasons.some((reason) => reason.code === 'client_visible_only_denied')).toBe(true);
  });

  it('returns redaction fields for hide_sensitive_fields rules', async () => {
    const provider = new BundleAuthorizationKernelProvider({
      resolveRules: async () => [
        {
          id: 'rule-2',
          resource: 'billing',
          action: 'read',
          constraintKey: 'hide_sensitive_fields',
          redactedFields: ['internal_cost', 'margin'],
        },
      ],
    });

    const result = await provider.evaluateNarrowing({
      subject: {
        tenant: 'tenant-a',
        userId: 'user-a',
        userType: 'internal',
      },
      resource: {
        type: 'billing',
        action: 'read',
      },
    });

    expect(result.redactedFields).toEqual(['internal_cost', 'margin']);
  });
});
