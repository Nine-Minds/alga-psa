import { describe, expect, it, vi } from 'vitest';
import { createAuthorizationKernel } from '../kernel/engine';
import { RequestLocalAuthorizationCache } from '../kernel/requestCache';
import type { AuthorizationSubject, BuiltinAuthorizationProvider } from '../kernel/contracts';

const builtinProvider: BuiltinAuthorizationProvider = {
  evaluate: async () => ({ allowed: true, scope: { allowAll: true, denied: false, constraints: [] }, reasons: [] }),
  authorizeMutation: async () => ({ allowed: true, reasons: [] }),
  resolveFieldRedactions: async () => ({ fields: [], reasons: [] }),
};

describe('tenant-qualified authorization cache', () => {
  it.each(['grant-first', 'deny-first'])('keeps one workspace decision out of another (%s)', async (order) => {
    const rbacEvaluator = vi.fn(async ({ subject }) => subject.tenant === 'msp');
    const kernel = createAuthorizationKernel({ builtinProvider, rbacEvaluator });
    const requestCache = new RequestLocalAuthorizationCache();
    const tenants = order === 'grant-first' ? ['msp', 'customer'] : ['customer', 'msp'];

    for (const tenant of tenants) {
      const input = {
        subject: { tenant, userId: 'same-user-id', userType: 'internal' as const },
        resource: { type: 'ticket', action: 'update' },
        requestCache,
      };
      expect((await kernel.authorizeResource(input)).allowed).toBe(tenant === 'msp');
      expect((await kernel.authorizeMutation(input)).allowed).toBe(tenant === 'msp');
    }
    // Each principal still gets request-local reuse within its own context.
    expect(rbacEvaluator).toHaveBeenCalledTimes(2);
  });

  it.each<Partial<AuthorizationSubject>>([
    { userType: 'client' }, { apiKeyId: 'restricted-key' },
    { subjectType: 'agent', agentId: 'restricted-agent' }, { roleIds: ['restricted-role'] },
  ])('does not reuse a decision after principal context changes: %j', async (changes) => {
    const rbacEvaluator = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const kernel = createAuthorizationKernel({ builtinProvider, rbacEvaluator });
    const input = {
      subject: { tenant: 'customer', userId: 'user', userType: 'internal' as const },
      resource: { type: 'ticket', action: 'read' },
      requestCache: new RequestLocalAuthorizationCache(),
    };
    expect((await kernel.authorizeResource(input)).allowed).toBe(true);
    expect((await kernel.authorizeResource({ ...input, subject: { ...input.subject, ...changes } })).allowed).toBe(false);
    expect(rbacEvaluator).toHaveBeenCalledTimes(2);
  });
});
