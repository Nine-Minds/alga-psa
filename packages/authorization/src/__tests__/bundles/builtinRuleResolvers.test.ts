import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import knexFactory from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUNDLE_CLOSED_BASELINE_DENIED_CODE,
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RESOLVER_CLIENT_VISIBLE_ONLY_DENIED_CODE,
  RESOLVER_CLOSED_BASELINE_DENIED_CODE,
  RESOLVER_TEMPLATE_DENIED_CODE,
  builtinResolverFactSources,
  builtinResolverFactsExpression,
  builtinResolverSubjectsExistExpression,
  builtinResolversRestrict,
  hasBuiltinRuleResolversWithoutFactSource,
  loadBuiltinResolverFacts,
  compileResourceReadAuthorizationSql,
  createAuthorizationKernel,
  registerBuiltinRuleResolver,
  resetBuiltinRuleResolversForTests,
  resolveDefaultBuiltinRelationshipRules,
  unregisterBuiltinRuleResolver,
  type AuthorizationEvaluationInput,
  type AuthorizationSubject,
  type BuiltinResolverRule,
  type BundleNarrowingRule,
} from '../../kernel';
import { bundleNarrowingRuleFromRow } from '../../bundles/service';

// T010 / F012: package-registered built-in rule resolvers.

const internal: AuthorizationSubject = {
  tenant: 't1', userId: 'internal-1', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [], clientId: 'c1',
  portfolioClientIds: ['c1'],
};
const client: AuthorizationSubject = { ...internal, userId: 'client-1', userType: 'client', clientId: 'c1' };
const seat: AuthorizationSubject = { ...internal, userId: 'seat-1', userType: 'internal' };

const inputFor = (
  subject: AuthorizationSubject,
  resource: string,
  action: string,
  record: Record<string, unknown> | undefined = { id: 'x', clientId: 'c1', ownerUserId: subject.userId }
) => ({ subject, resource: { type: resource, action }, ...(record ? { record } : {}) } as AuthorizationEvaluationInput);

const register = (
  id: string,
  rules: BuiltinResolverRule[],
  opts: { baseline?: 'open' | 'closed'; appliesTo?: (i: AuthorizationEvaluationInput) => boolean } = {}
) =>
  registerBuiltinRuleResolver({
    id,
    baseline: opts.baseline,
    appliesTo: opts.appliesTo ?? ((i) => i.subject.userId === 'seat-1'),
    resolveRules: () => rules,
  });

const rr = (id: string, resource: string, action: string, extra: Partial<BuiltinResolverRule> = {}): BuiltinResolverRule => ({
  id, resource, action, templateKey: 'same_client', ...extra,
});

const bundleRule = (id: string, bundleId: string, baseline: 'open' | 'closed', resource: string, action: string,
  extra: Partial<BundleNarrowingRule> = {}): BundleNarrowingRule => ({
  id, bundleId, revisionId: `${bundleId}-rev`, baseline, resource, action, templateKey: 'same_client', ...extra,
});

const kernelFor = (bundleRules: BundleNarrowingRule[] | null, builtinConfig = {}) =>
  createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(builtinConfig),
    bundleProvider: bundleRules ? new BundleAuthorizationKernelProvider({ resolveRules: async () => bundleRules }) : undefined,
    rbacEvaluator: async () => true,
  });

beforeEach(() => resetBuiltinRuleResolversForTests());
afterEach(() => resetBuiltinRuleResolversForTests());

describe('registered resolver applies to its class', () => {
  it('narrows subjects in the class and names the resolver in its reasons', async () => {
    register('seat', [rr('s1', 'ticket', 'read')]);
    const kernel = kernelFor(null);
    const ok = await kernel.authorizeResource(inputFor(seat, 'ticket', 'read'));
    expect(ok.allowed).toBe(true);
    expect(ok.reasons.some((r) => r.sourceType === 'resolver' && r.sourceId === 'seat')).toBe(true);

    const denied = await kernel.authorizeResource(inputFor(seat, 'ticket', 'read', { id: 'y', clientId: 'other' }));
    expect(denied.allowed).toBe(false);
    const reason = denied.reasons.find((r) => r.code === RESOLVER_TEMPLATE_DENIED_CODE)!;
    expect(reason).toMatchObject({ sourceType: 'resolver', sourceId: 'seat', stage: 'builtin' });
  });

  it('emits rule constraints in scope-only evaluation', async () => {
    register('seat', [rr('s1', 'ticket', 'read', { templateKey: null, constraints: [{ field: 'board_id', operator: 'eq', value: 'b1' }] })]);
    const decision = await kernelFor(null).authorizeResource(inputFor(seat, 'ticket', 'read', undefined));
    expect(decision.allowed).toBe(true);
    expect(decision.scope).toMatchObject({ allowAll: false, denied: false, constraints: [{ field: 'board_id', value: 'b1' }] });
  });
});

describe('subjects outside the class are unaffected', () => {
  it('produces output identical to nothing registered', async () => {
    const cases = [
      inputFor(internal, 'ticket', 'read'), inputFor(internal, 'ticket', 'read', undefined),
      inputFor(client, 'ticket', 'read'), inputFor(client, 'ticket', 'read', { id: 'z', clientId: 'other' }),
      inputFor(client, 'asset', 'update'),
    ];
    const bundle = [bundleRule('b1', 'bun', 'closed', 'ticket', 'read')];
    const before = await Promise.all(cases.map((c) => kernelFor(bundle).authorizeResource(c)));
    register('seat', [rr('s1', 'ticket', 'read')], { baseline: 'closed' });
    register('other', [], { baseline: 'closed', appliesTo: () => false });
    const after = await Promise.all(cases.map((c) => kernelFor(bundle).authorizeResource(c)));
    expect(after).toEqual(before);
  });
});

describe('closed baseline', () => {
  it('denies unnamed resource/action, allows named, and names the resolver', async () => {
    register('seat', [rr('s1', 'ticket', 'read'), rr('s2', 'ticket', 'update')], { baseline: 'closed' });
    const kernel = kernelFor(null);
    expect((await kernel.authorizeResource(inputFor(seat, 'ticket', 'read'))).allowed).toBe(true);
    // alias-aware: delete inherits update
    expect((await kernel.authorizeResource(inputFor(seat, 'ticket', 'delete'))).allowed).toBe(true);
    const project = await kernel.authorizeResource(inputFor(seat, 'project', 'read'));
    expect(project.allowed).toBe(false);
    expect(project.scope.denied).toBe(true);
    expect(project.reasons.find((r) => r.code === RESOLVER_CLOSED_BASELINE_DENIED_CODE)).toMatchObject({
      sourceType: 'resolver', sourceId: 'seat',
    });
    expect((await kernel.authorizeResource(inputFor(seat, 'ticket', 'create'))).allowed).toBe(false);
  });

  it('a closed resolver with no rules denies everything for its class', async () => {
    register('seat', [], { baseline: 'closed' });
    expect((await kernelFor(null).authorizeResource(inputFor(seat, 'ticket', 'read'))).allowed).toBe(false);
  });

  it('an open resolver does not deny unnamed resources', async () => {
    register('seat', [rr('s1', 'ticket', 'read')]);
    expect((await kernelFor(null).authorizeResource(inputFor(seat, 'project', 'read'))).allowed).toBe(true);
  });

  it('SQL path denies like the JS path', () => {
    const db = knexFactory({ client: 'pg' });
    const ctx = { subject: seat, adapter: { clientColumn: 'client_id' } } as any;
    const sql = (resource: string, action: string) => {
      const q = db('tickets').select('*');
      const r = compileResourceReadAuthorizationSql(q, { resourceType: resource, action, builtinRules: [], bundleRules: [], ctx });
      return { r, text: q.toString() };
    };
    const before = sql('project', 'read');
    expect(before.text).not.toContain('1 = 0');
    register('seat', [rr('s1', 'ticket', 'read', { templateKey: 'same_client' })], { baseline: 'closed' });
    const denied = sql('project', 'read');
    expect(denied.r).toEqual({ supported: true });
    expect(denied.text).toContain('1 = 0');
    const named = sql('ticket', 'read');
    expect(named.text).not.toContain('1 = 0');
    expect(named.text).toContain('client_id');
    void db.destroy();
  });
});

describe('order relative to bundle rules', () => {
  it('runs before bundle reasons, and a bundle cannot widen what a resolver narrowed', async () => {
    register('seat', [rr('s1', 'ticket', 'read')]);
    // the bundle rule has no template, so it would allow everything on its own
    const bundle = [bundleRule('b1', 'bun', 'open', 'ticket', 'read', { templateKey: null })];
    const foreign = inputFor(seat, 'ticket', 'read', { id: 'y', clientId: 'other' });
    const decision = await kernelFor(bundle).authorizeResource(foreign);
    expect(decision.allowed).toBe(false);
    const codes = decision.reasons.map((r) => r.sourceType);
    expect(codes.indexOf('resolver')).toBeGreaterThan(-1);
    expect(codes.indexOf('resolver')).toBeLessThan(codes.indexOf('bundle'));
  });

  it('closed bundle and closed resolver together deny the union of what each leaves unnamed', async () => {
    register('seat', [rr('s1', 'ticket', 'read'), rr('s2', 'asset', 'read')], { baseline: 'closed' });
    const bundle = [bundleRule('b1', 'bun', 'closed', 'ticket', 'read'), bundleRule('b2', 'bun', 'closed', 'project', 'read')];
    const kernel = kernelFor(bundle);
    const allowedFor = async (r: string) => (await kernel.authorizeResource(inputFor(seat, r, 'read'))).allowed;
    expect(await allowedFor('ticket')).toBe(true); // named by both
    expect(await allowedFor('asset')).toBe(false); // bundle leaves it unnamed
    expect(await allowedFor('project')).toBe(false); // resolver leaves it unnamed
    expect(await allowedFor('contact')).toBe(false); // both
    const both = await kernel.authorizeResource(inputFor(seat, 'contact', 'read'));
    expect(both.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining([RESOLVER_CLOSED_BASELINE_DENIED_CODE, BUNDLE_CLOSED_BASELINE_DENIED_CODE])
    );
  });
});

describe('composition with other built-in rules and between resolvers', () => {
  it('never widens the default for a client user', async () => {
    const clientResolver = { appliesTo: (i: AuthorizationEvaluationInput) => i.subject.userType === 'client' };
    register('wide', [rr('w1', 'ticket', 'read', { templateKey: null })], clientResolver);
    const foreign = inputFor(client, 'ticket', 'read', { id: 'y', clientId: 'other' });
    for (const config of [{}, { resolveRelationshipRules: resolveDefaultBuiltinRelationshipRules }]) {
      expect((await kernelFor(null, config).authorizeResource(foreign)).allowed).toBe(false);
    }
  });

  it('takes effect with a caller-supplied resolveRelationshipRules and static relationshipRules', async () => {
    register('seat', [], { baseline: 'closed' });
    for (const config of [
      { resolveRelationshipRules: () => [] },
      { relationshipRules: [] },
      { resolveRelationshipRules: resolveDefaultBuiltinRelationshipRules },
    ]) {
      expect((await kernelFor(null, config).authorizeResource(inputFor(seat, 'ticket', 'read'))).allowed).toBe(false);
    }
  });

  it('composes several matching resolvers: all must allow, each denial is reported', async () => {
    register('a', [rr('a1', 'ticket', 'read')]);
    register('b', [rr('b1', 'ticket', 'read', { templateKey: 'own' })]);
    const kernel = kernelFor(null);
    expect((await kernel.authorizeResource(inputFor(seat, 'ticket', 'read'))).allowed).toBe(true);
    const foreign = await kernel.authorizeResource(inputFor(seat, 'ticket', 'read', { id: 'y', clientId: 'other', ownerUserId: 'nobody' }));
    expect(foreign.allowed).toBe(false);
    expect(foreign.reasons.filter((r) => r.code === RESOLVER_TEMPLATE_DENIED_CODE).map((r) => r.sourceId)).toEqual(['a', 'b']);
  });
});

describe('registration', () => {
  it('replaces on re-registering the same id and never stacks', async () => {
    register('seat', [], { baseline: 'closed' });
    register('seat', [rr('s1', 'ticket', 'read')]);
    register('seat', [rr('s1', 'ticket', 'read')]);
    const kernel = kernelFor(null);
    const decision = await kernel.authorizeResource(inputFor(seat, 'project', 'read'));
    expect(decision.allowed).toBe(true); // the closed first registration is gone
    const applied = (await kernel.authorizeResource(inputFor(seat, 'ticket', 'read'))).reasons.filter((r) => r.sourceType === 'resolver');
    expect(applied).toHaveLength(1);
  });

  it('unregister and reset restore the unchanged behaviour', async () => {
    register('seat', [], { baseline: 'closed' });
    unregisterBuiltinRuleResolver('seat');
    expect((await kernelFor(null).authorizeResource(inputFor(seat, 'ticket', 'read'))).allowed).toBe(true);
    register('seat', [], { baseline: 'closed' });
    resetBuiltinRuleResolversForTests();
    expect((await kernelFor(null).authorizeResource(inputFor(seat, 'ticket', 'read'))).allowed).toBe(true);
  });
});

describe('nothing registered', () => {
  it('matches the existing behaviour for client, internal and bundle-assigned subjects', async () => {
    const own = { id: 'x', clientId: 'c1' };
    const foreign = { id: 'y', clientId: 'other' };
    expect((await kernelFor(null).authorizeResource(inputFor(client, 'ticket', 'read', own))).allowed).toBe(true);
    expect((await kernelFor(null).authorizeResource(inputFor(client, 'ticket', 'read', foreign))).allowed).toBe(false);
    const internalDecision = await kernelFor(null).authorizeResource(inputFor(internal, 'ticket', 'read', foreign));
    expect(internalDecision).toMatchObject({ allowed: true, scope: { denied: false, constraints: [] } });
    expect(internalDecision.reasons.every((r) => r.sourceType !== 'resolver')).toBe(true);
    const bundle = [bundleRule('b1', 'bun', 'closed', 'ticket', 'read')];
    expect((await kernelFor(bundle).authorizeResource(inputFor(internal, 'ticket', 'read', own))).allowed).toBe(true);
    expect((await kernelFor(bundle).authorizeResource(inputFor(internal, 'project', 'read', own))).allowed).toBe(false);
  });
});

describe('bundle service does not list or edit resolver rules', () => {
  it('maps database rows to rules with a bundle id, and the registry adds none', () => {
    register('seat', [rr('resolver-rule-1', 'ticket', 'read')], { baseline: 'closed' });
    const row = bundleNarrowingRuleFromRow({
      rule_id: 'db-1', resource_type: 'ticket', action: 'read', template_key: 'same_client', constraint_key: null,
      config: {}, bundle_id: 'bun', revision_id: 'rev', baseline: 'closed',
    });
    expect(row).toMatchObject({ id: 'db-1', bundleId: 'bun' });
  });

  it('neither service module references the registry (no list/edit path)', () => {
    const root = resolve(__dirname, '../../../../..');
    for (const file of ['packages/authorization/src/bundles/service.ts', 'server/src/lib/authorization/bundles/service.ts']) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/BuiltinRuleResolver|builtinRuleResolvers|resolveAppliedBuiltinResolvers/);
    }
  });
});

describe('builtinResolversRestrict (consumers that skip per-record authorization when unrestricted)', () => {
  it('is false with nothing registered, true for a closed resolver that does not name the resource', () => {
    const asset = inputFor(seat, 'asset', 'read', undefined);
    expect(builtinResolversRestrict(asset)).toBe(false);
    register('seat', [rr('s1', 'ticket', 'read')], { baseline: 'closed' });
    expect(builtinResolversRestrict(asset)).toBe(true);
    expect(builtinResolversRestrict(inputFor(internal, 'asset', 'read', undefined))).toBe(false);
    resetBuiltinRuleResolversForTests();
    register('seat', [rr('s1', 'ticket', 'read')]); // open and not naming asset
    expect(builtinResolversRestrict(asset)).toBe(false);
  });
});

// Co-managed seat plan S11: what a resolver needs beyond client and board templates.
describe('selected_records template and client_visible_only guard on resolver rules', () => {
  const adapter = { idColumn: 'r.id', clientVisibleColumn: 'r.is_client_visible', applyAssignedUsers: () => undefined };
  const sqlFor = (resource: string, sqlAdapter: Record<string, unknown> = adapter) => {
    const knex = knexFactory({ client: 'pg' });
    const builder = knex('records as r');
    const result = compileResourceReadAuthorizationSql(builder, {
      resourceType: resource, action: 'read', builtinRules: [], bundleRules: [], ctx: { subject: seat, adapter: sqlAdapter as never },
    });
    expect(result.supported).toBe(true);
    return builder.toQuery();
  };

  it('admits only the listed records, in JS and in SQL; an empty list and a missing id column deny', async () => {
    register('seat', [
      rr('p1', 'project', 'read', { templateKey: 'selected_records', selectedRecordIds: ['p-shared'] }),
      rr('a1', 'asset', 'read', { templateKey: 'selected_records', selectedRecordIds: [] }),
    ]);
    const kernel = kernelFor(null, { relationshipRules: [] });
    expect((await kernel.authorizeResource(inputFor(seat, 'project', 'read', { id: 'p-shared' }))).allowed).toBe(true);
    const denied = await kernel.authorizeResource(inputFor(seat, 'project', 'read', { id: 'p-other' }));
    expect(denied.allowed).toBe(false);
    expect(denied.reasons.find((r) => r.code === RESOLVER_TEMPLATE_DENIED_CODE)).toMatchObject({ metadata: { ruleIds: ['p1'] } });
    expect((await kernel.authorizeResource(inputFor(seat, 'asset', 'read', { id: 'anything' }))).allowed).toBe(false);

    expect(sqlFor('project')).toBe(`select * from "records" as "r" where ("r"."id" in ('p-shared'))`);
    expect(sqlFor('asset')).toBe('select * from "records" as "r" where (1 = 0)');
    expect(sqlFor('project', { applyAssignedUsers: () => undefined })).toBe('select * from "records" as "r" where (1 = 0)');
  });

  it('client_visible_only denies a record that is not client-visible and names the rule', async () => {
    register('seat', [rr('d1', 'document', 'read', { templateKey: null, constraintKey: 'client_visible_only' })]);
    const kernel = kernelFor(null, { relationshipRules: [] });
    expect((await kernel.authorizeResource(inputFor(seat, 'document', 'read', { id: 'd', is_client_visible: true }))).allowed).toBe(true);
    for (const record of [{ id: 'd', is_client_visible: false }, { id: 'd' }]) {
      const denied = await kernel.authorizeResource(inputFor(seat, 'document', 'read', record));
      expect(denied.allowed).toBe(false);
      expect(denied.reasons.find((r) => r.code === RESOLVER_CLIENT_VISIBLE_ONLY_DENIED_CODE))
        .toMatchObject({ sourceType: 'resolver', sourceId: 'seat', metadata: { ruleIds: ['d1'] } });
    }
    expect(sqlFor('document')).toBe('select * from "records" as "r" where "r"."is_client_visible" = true');
    expect(sqlFor('document', { applyAssignedUsers: () => undefined })).toBe('select * from "records" as "r" where 1 = 0');
  });
});

describe('resolver fact sources', () => {
  const source = {
    tenantHasSubjects: (knex: any, tenant: string) => knex('seat_rows').where({ tenant }),
    subjectFacts: (knex: any, subject: { tenant: string; userId: string }) =>
      knex('seat_rows').where({ tenant: subject.tenant, user_id: subject.userId }).select(knex.raw('to_jsonb(seat_rows)')),
  };
  const withFacts = (id: string) => registerBuiltinRuleResolver({ id, facts: source, appliesTo: () => false, resolveRules: () => [] });

  it('lists only resolvers that declare one, in id order, and composes one expression keyed by resolver id', () => {
    const knex = knexFactory({ client: 'pg' });
    expect(builtinResolverFactsExpression(knex, { tenant: 't1', userId: 'u1' })).toBeNull();
    register('plain', []);
    expect(builtinResolverFactSources()).toEqual([]);
    expect(hasBuiltinRuleResolversWithoutFactSource()).toBe(true);

    withFacts('zeta');
    withFacts('alpha');
    expect(builtinResolverFactSources().map((entry) => entry.id)).toEqual(['alpha', 'zeta']);
    expect(builtinResolverFactsExpression(knex, { tenant: 't1', userId: 'u1' })!.toQuery()).toBe(
      `jsonb_build_object('alpha'::text, (select to_jsonb(seat_rows) from "seat_rows" where "tenant" = 't1' and "user_id" = 'u1'), ` +
      `'zeta'::text, (select to_jsonb(seat_rows) from "seat_rows" where "tenant" = 't1' and "user_id" = 'u1'))`
    );
    unregisterBuiltinRuleResolver('plain');
    expect(hasBuiltinRuleResolversWithoutFactSource()).toBe(false);
  });

  it('gates on the tenant probe of every fact source, never on the tables the facts are read from', () => {
    const knex = knexFactory({ client: 'pg' });
    expect(builtinResolverSubjectsExistExpression(knex, 't1')).toBeNull();
    register('plain', []);
    expect(builtinResolverSubjectsExistExpression(knex, 't1')).toBeNull();

    const gated = (table: string) => ({ ...source, tenantHasSubjects: (k: any, tenant: string) => k(table).where({ tenant }) });
    registerBuiltinRuleResolver({ id: 'zeta', facts: gated('zeta_members'), appliesTo: () => false, resolveRules: () => [] });
    registerBuiltinRuleResolver({ id: 'alpha', facts: gated('alpha_members'), appliesTo: () => false, resolveRules: () => [] });
    const sql = builtinResolverSubjectsExistExpression(knex, 't1')!.toQuery();
    expect(sql).toBe(
      `(exists((select 1 from "alpha_members" where "tenant" = 't1')) or exists((select 1 from "zeta_members" where "tenant" = 't1')))`
    );
    expect(sql).not.toContain('seat_rows');
  });

  it('loads nothing when no resolver has a fact source, and a load that returns no facts is a failure', async () => {
    const failing = { queryBuilder: () => { throw new Error('must not query'); } } as never;
    await expect(loadBuiltinResolverFacts(failing, { tenant: 't1', userId: 'u1' })).resolves.toBeUndefined();

    withFacts('alpha');
    const knex = knexFactory({ client: 'pg' });
    const answering = (row: unknown) => Object.assign((table: string) => knex(table),
      { raw: knex.raw.bind(knex), queryBuilder: () => ({ select: () => ({ first: async () => row }) }) }) as never;
    await expect(loadBuiltinResolverFacts(answering({ facts: { alpha: { ok: true } } }), { tenant: 't1', userId: 'u1' }))
      .resolves.toEqual({ alpha: { ok: true } });
    await expect(loadBuiltinResolverFacts(answering(undefined), { tenant: 't1', userId: 'u1' })).rejects.toThrow('Built-in resolver facts unavailable');
    await expect(loadBuiltinResolverFacts(answering({ facts: null }), { tenant: 't1', userId: 'u1' })).rejects.toThrow('Built-in resolver facts unavailable');
  });
});
