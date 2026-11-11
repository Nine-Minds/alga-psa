import knexFactory from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  registerBuiltinRuleResolver,
  resetBuiltinRuleResolversForTests,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import {
  compileCredentialReadScopeSql,
  type CredentialAuthorizationContext,
} from '../../../../../ee/server/src/lib/credentials/credentialAuthorization';

// The credential list SQL must consult registered built-in rule resolvers like the JS kernel does.
const subject: AuthorizationSubject = {
  tenant: 't1', userId: 'seat-1', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [],
};
const db = knexFactory({ client: 'pg' });

const compile = () => {
  const builder = db('credentials as cr').select('*');
  const result = compileCredentialReadScopeSql(
    { tenant: 't1', builder } as any,
    { subject, bundleNarrowingRules: [], requestCache: {} as any } as CredentialAuthorizationContext
  );
  return { result, sql: builder.toString() };
};

describe('compileCredentialReadScopeSql with built-in rule resolvers', () => {
  beforeEach(() => resetBuiltinRuleResolversForTests());
  afterEach(() => resetBuiltinRuleResolversForTests());

  it('is unchanged with nothing registered, and for subjects outside a resolver class', () => {
    const before = compile();
    registerBuiltinRuleResolver({ id: 'other', baseline: 'closed', appliesTo: () => false, resolveRules: () => [] });
    expect(compile()).toEqual(before);
    expect(before.sql).not.toContain('1 = 0 and');
  });

  it('denies when a closed resolver does not name credential:read, allows when it does', () => {
    registerBuiltinRuleResolver({
      id: 'seat', baseline: 'closed', appliesTo: (i) => i.subject.userId === 'seat-1',
      resolveRules: () => [{ id: 'r', resource: 'ticket', action: 'read' }],
    });
    const denied = compile();
    expect(denied.result).toEqual({ supported: true });
    expect(denied.sql).toMatch(/and 1 = 0$/);

    registerBuiltinRuleResolver({
      id: 'seat', baseline: 'closed', appliesTo: (i) => i.subject.userId === 'seat-1',
      resolveRules: () => [{ id: 'r', resource: 'credential', action: 'read' }],
    });
    expect(compile().sql).not.toMatch(/and 1 = 0$/);
  });
});
