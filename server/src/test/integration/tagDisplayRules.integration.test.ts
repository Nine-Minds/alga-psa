import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

/**
 * Display rules against a migrated schema (T016, T017, T021):
 *  - replace/read ordered rules; orphan cleanup keeps a referenced definition; explicit delete cascades
 *  - the migration seeds VIP rules for existing contact/client VIP definitions; onboarding seeds both
 *  - client-portal users cannot read entity tags; rule writes need settings:update
 */

const authMocks = vi.hoisted(() => ({
  user: null as any,
  tenant: null as string | null,
  hasPermission: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, authMocks.user ? { tenant: authMocks.tenant } : null, ...args),
}));
vi.mock('../../../../packages/tags/src/lib/authHelpers', () => ({
  hasPermissionAsync: (...args: any[]) => authMocks.hasPermission(...args),
  throwPermissionErrorAsync: async (action: string) => {
    throw new Error(`Permission denied: ${action}`);
  },
}));

const describeDb = await describeWithDb();

let db: Knex;
let tenantId: string;
let actorId: string;
let otherTenantId: string;

const contactVip = uuidv4();
const contactGold = uuidv4();
const clientVip = uuidv4();
const ticketVip = uuidv4();

async function seedTenant(label: string): Promise<{ tenant: string; actor: string }> {
  const tenant = uuidv4();
  const actor = uuidv4();
  await db('tenants').insert({
    tenant,
    client_name: `${label} ${tenant.slice(0, 8)}`,
    email: `${label}-${tenant.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });
  await db('users').insert({
    tenant,
    user_id: actor,
    username: `actor-${actor.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `actor-${actor.slice(0, 8)}@example.com`,
    first_name: 'Actor',
    last_name: label,
    user_type: 'internal',
    is_inactive: false,
    timezone: 'UTC',
  });
  return { tenant, actor };
}

const def = (tag_id: string, tag_text: string, tagged_type: string, tenant = tenantId) => ({
  tenant, tag_id, tag_text, tagged_type,
});

describeDb('tag display rules (DB)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    ({ tenant: tenantId, actor: actorId } = await seedTenant('Rules'));
    ({ tenant: otherTenantId } = await seedTenant('RulesOther'));
    await db('tag_definitions').insert([
      def(contactVip, 'VIP', 'contact'),
      def(contactGold, 'Gold', 'contact'),
      def(clientVip, 'VIP', 'client'),
      def(ticketVip, 'VIP', 'ticket'),
    ]);
  }, 300000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60000);

  beforeEach(async () => {
    authMocks.tenant = tenantId;
    authMocks.user = { user_id: actorId, user_type: 'internal', tenant: tenantId };
    authMocks.hasPermission.mockResolvedValue(true);
    await db('tag_display_rules').where({ tenant: tenantId }).del();
    await db('tag_references').where({ tenant: tenantId }).del();
  });

  describe('T016 rules, orphan cleanup, cascade', () => {
    it('replaces an ordered list per (type, audience) and reads it back in order', async () => {
      const actions = await import('../../../../packages/tags/src/actions/tagDisplayRuleActions');
      const written = await actions.replaceTagDisplayRules('contact', 'internal', [contactGold, contactVip]);
      expect(Array.isArray(written) && written.map((r) => [r.tag_id, r.position])).toEqual([[contactGold, 0], [contactVip, 1]]);

      await actions.replaceTagDisplayRules('contact', 'client', [contactVip]);
      const internal = await actions.listTagDisplayRules('contact');
      expect(Array.isArray(internal) && internal.filter((r) => r.audience === 'internal').map((r) => r.tag_id)).toEqual([contactGold, contactVip]);

      await actions.replaceTagDisplayRules('contact', 'internal', [contactVip]);
      const after = await actions.listTagDisplayRules('contact');
      expect(Array.isArray(after) && after.filter((r) => r.audience === 'internal').map((r) => r.tag_id)).toEqual([contactVip]);
    });

    it('rejects a definition of the wrong entity type and leaves existing rules alone', async () => {
      const actions = await import('../../../../packages/tags/src/actions/tagDisplayRuleActions');
      await actions.replaceTagDisplayRules('contact', 'internal', [contactVip]);
      const result = await actions.replaceTagDisplayRules('contact', 'internal', [clientVip]);
      expect(Array.isArray(result)).toBe(false);
      const rows = await db('tag_display_rules').where({ tenant: tenantId, tagged_type: 'contact' });
      expect(rows.map((r) => r.tag_id)).toEqual([contactVip]);
    });

    it('keeps a referenced definition when its last mapping goes, and findAllTagsByType still lists it', async () => {
      const tags = await import('../../../../packages/tags/src/actions/tagActions');
      const contactId = uuidv4();
      const mappingId = uuidv4();
      await db('tag_mappings').insert({
        tenant: tenantId, mapping_id: mappingId, tag_id: contactGold, tagged_id: contactId, tagged_type: 'contact',
      });
      // Rules are written through the action so their tag_references come with them.
      const actions = await import('../../../../packages/tags/src/actions/tagDisplayRuleActions');
      await actions.replaceTagDisplayRules('contact', 'internal', [contactGold]);

      await db('tag_mappings').where({ tenant: tenantId, mapping_id: mappingId }).del();
      const { default: TagDefinition } = await import('../../../../packages/tags/src/models/tagDefinition');
      const removed = await TagDefinition.deleteOrphaned(db, tenantId, [contactGold]);
      expect(removed).toBe(0);
      expect(await db('tag_definitions').where({ tenant: tenantId, tag_id: contactGold }).first()).toBeTruthy();

      const listed = await tags.findAllTagsByType('contact');
      expect(Array.isArray(listed) && listed.map((t) => t.tag_text)).toContain('Gold');

      // Without the rule (and so its reference) the same orphan is cleaned up and unlisted.
      await actions.replaceTagDisplayRules('contact', 'internal', []);
      const listedWithoutRule = await tags.findAllTagsByType('contact');
      expect(Array.isArray(listedWithoutRule) && listedWithoutRule.map((t) => t.tag_text)).not.toContain('Gold');
      expect(await TagDefinition.deleteOrphaned(db, tenantId, [contactGold])).toBe(1);
      await db('tag_definitions').insert(def(contactGold, 'Gold', 'contact'));
    });

    it('cascades a rule when its definition is explicitly deleted', async () => {
      const tempId = uuidv4();
      await db('tag_definitions').insert(def(tempId, 'Temp', 'client'));
      await db('tag_display_rules').insert({
        tenant: tenantId, tagged_type: 'client', audience: 'internal', tag_id: tempId, position: 0,
      });
      await db('tag_definitions').where({ tenant: tenantId, tag_id: tempId }).del();
      expect(await db('tag_display_rules').where({ tenant: tenantId, tag_id: tempId })).toHaveLength(0);
    });

    it('TagDefinition.delete removes the definition and its references; a rule left behind is dangling and never shown', async () => {
      const tempId = uuidv4();
      await db('tag_definitions').insert(def(tempId, 'TempModelDelete', 'client'));
      const actions = await import('../../../../packages/tags/src/actions/tagDisplayRuleActions');
      await actions.replaceTagDisplayRules('client', 'internal', [tempId]);
      const { default: TagDefinition } = await import('../../../../packages/tags/src/models/tagDefinition');
      await db.transaction((trx) => TagDefinition.delete(trx, tenantId, tempId));
      expect(await db('tag_definitions').where({ tenant: tenantId, tag_id: tempId })).toHaveLength(0);
      expect(await db('tag_references').where({ tenant: tenantId, tag_id: tempId })).toHaveLength(0);

      // With the FK the rule cascades away; without it (Citus) the rule dangles. Either way no chip.
      const { loadDisplayTagsForEntities } = await import('../../../../packages/tags/src/lib/loadDisplayTags');
      const shown = await loadDisplayTagsForEntities(db, tenantId, 'internal', [{ taggedType: 'client', ids: [uuidv4()] }]);
      expect(shown.size).toBe(0);

      // The next write of that list prunes any dangling rule.
      await actions.replaceTagDisplayRules('client', 'internal', [clientVip]);
      expect((await db('tag_display_rules').where({ tenant: tenantId, tagged_type: 'client' })).map((r) => r.tag_id)).toEqual([clientVip]);
    });

    it('rule writes create and remove tag_references rows', async () => {
      const actions = await import('../../../../packages/tags/src/actions/tagDisplayRuleActions');
      const refs = () => db('tag_references').where({ tenant: tenantId, referrer_type: 'tag_display_rule' });
      await actions.replaceTagDisplayRules('contact', 'internal', [contactGold, contactVip]);
      const rules = await db('tag_display_rules').where({ tenant: tenantId });
      expect((await refs()).map((r) => [r.referrer_id, r.tag_id]).sort()).toEqual(
        rules.map((r) => [r.rule_id, r.tag_id]).sort(),
      );
      await actions.replaceTagDisplayRules('contact', 'internal', [contactVip]);
      expect((await refs()).map((r) => r.tag_id)).toEqual([contactVip]);
      await actions.replaceTagDisplayRules('contact', 'internal', []);
      expect(await refs()).toHaveLength(0);
    });

    it('rules are tenant scoped', async () => {
      await db('tag_display_rules').insert({
        tenant: tenantId, tagged_type: 'contact', audience: 'internal', tag_id: contactVip, position: 0,
      });
      const actions = await import('../../../../packages/tags/src/actions/tagDisplayRuleActions');
      authMocks.tenant = otherTenantId;
      authMocks.user = { user_id: actorId, user_type: 'internal', tenant: otherTenantId };
      const rules = await actions.listTagDisplayRules();
      expect(rules).toEqual([]);
    });
  });

  describe('T017 migration seed and onboarding seed', () => {
    const require = createRequire(import.meta.url);
    const root = path.resolve(__dirname, '../../../..');

    it('the migration seeds an internal rule for existing contact and client VIP definitions only', async () => {
      const { tenant } = await seedTenant('MigSeed');
      const c = uuidv4();
      const k = uuidv4();
      const t = uuidv4();
      const n = uuidv4();
      await db('tag_definitions').insert([
        def(c, ' vip ', 'contact', tenant),
        def(k, 'Vip', 'client', tenant),
        def(t, 'VIP', 'ticket', tenant),
        def(n, 'Gold', 'contact', tenant),
      ]);
      const migration = require(path.join(root, 'server/migrations/20261028020200_create_tag_display_rules.cjs'));
      await migration.up(db);
      await migration.up(db); // idempotent

      const rules = await db('tag_display_rules').where({ tenant }).orderBy('tagged_type');
      expect(rules.map((r) => [r.tagged_type, r.audience, r.tag_id, r.position])).toEqual([
        ['client', 'internal', k, 0],
        ['contact', 'internal', c, 0],
      ]);
    });

    it('onboarding creates both VIP definitions with internal rules, and is idempotent', async () => {
      const { tenant } = await seedTenant('Onboard');
      const seed = require(path.join(root, 'ee/server/seeds/onboarding/psa/12_vip_tags.cjs'));
      await seed.seed(db, tenant);
      await seed.seed(db, tenant);

      const defs = await db('tag_definitions').where({ tenant, tag_text: 'VIP' }).orderBy('tagged_type');
      expect(defs.map((d) => d.tagged_type)).toEqual(['client', 'contact']);
      const rules = await db('tag_display_rules').where({ tenant }).orderBy('tagged_type');
      expect(rules.map((r) => [r.tagged_type, r.audience])).toEqual([['client', 'internal'], ['contact', 'internal']]);
      expect(rules.map((r) => r.tag_id).sort()).toEqual(defs.map((d) => d.tag_id).sort());
      const refs = await db('tag_references').where({ tenant, referrer_type: 'tag_display_rule' });
      expect(refs.map((r) => r.referrer_id).sort()).toEqual(rules.map((r) => r.rule_id).sort());
    });

    it('the tag_references migration backfills one reference per existing rule, idempotently', async () => {
      const { tenant } = await seedTenant('RefBackfill');
      const c = uuidv4();
      await db('tag_definitions').insert(def(c, 'BackfillTag', 'contact', tenant));
      const [rule] = await db('tag_display_rules')
        .insert({ tenant, tagged_type: 'contact', audience: 'internal', tag_id: c, position: 0 })
        .returning('rule_id');
      const migration = require(path.join(root, 'server/migrations/20261028030000_create_tag_references.cjs'));
      await migration.up(db);
      await migration.up(db);
      const refs = await db('tag_references').where({ tenant });
      expect(refs.map((r) => [r.tag_id, r.referrer_type, r.referrer_id])).toEqual([[c, 'tag_display_rule', rule.rule_id]]);
    });
  });

  describe('T021 security', () => {
    it('denies a client-portal user findTagsByEntityId and findTagsByEntityIds', async () => {
      const tags = await import('../../../../packages/tags/src/actions/tagActions');
      authMocks.user = { user_id: uuidv4(), user_type: 'client', tenant: tenantId };
      authMocks.hasPermission.mockResolvedValue(false);

      const one = await tags.findTagsByEntityId(uuidv4(), 'contact');
      const many = await tags.findTagsByEntityIds([uuidv4()], 'contact');
      expect(Array.isArray(one)).toBe(false);
      expect(Array.isArray(many)).toBe(false);
      expect((one as any).permissionError ?? (one as any).error).toBeTruthy();
      expect((many as any).permissionError ?? (many as any).error).toBeTruthy();
    });

    it('requires settings:update to write rules, and denies client users reads', async () => {
      const actions = await import('../../../../packages/tags/src/actions/tagDisplayRuleActions');
      authMocks.hasPermission.mockImplementation(async (_u: any, resource: string, action: string) => !(resource === 'settings' && action === 'update'));
      const denied = await actions.replaceTagDisplayRules('contact', 'internal', [contactVip]);
      expect(Array.isArray(denied)).toBe(false);
      expect(await db('tag_display_rules').where({ tenant: tenantId })).toHaveLength(0);

      authMocks.hasPermission.mockResolvedValue(true);
      expect(Array.isArray(await actions.replaceTagDisplayRules('contact', 'internal', [contactVip]))).toBe(true);

      authMocks.user = { user_id: uuidv4(), user_type: 'client', tenant: tenantId };
      expect(Array.isArray(await actions.listTagDisplayRules())).toBe(false);
      expect(Array.isArray(await actions.replaceTagDisplayRules('contact', 'client', [contactVip]))).toBe(false);
    });
  });
});
