import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestContext } from '../../../../test-utils/testContext';
import { clientResolvers } from '@alga-psa/authorization/kernel';
import {
  UNKNOWN_KIND,
  dropForeignTenant,
  polymorphicRowsAllowed,
  seedPolymorphicFixture,
  type PolymorphicFixture,
  type PolymorphicTemplate,
} from './polymorphicClientFixture';

// T004 (tagged_entity). tag_mappings has no client column: the client is the owner
// of the entity the (tagged_type, tagged_id) pair points at.

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const TEMPLATES: PolymorphicTemplate[] = ['client_portfolio', 'selected_clients'];

describe('tagged_entity client resolver (tag_mappings)', () => {
  let ctx: TestContext;
  let fx: PolymorphicFixture;
  /** tag_mappings.mapping_id by label */
  const mapping: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await helpers.beforeAll();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    fx = await seedPolymorphicFixture(ctx.db, ctx.tenantId, ctx.userId);

    const targets: Array<[string, string, string]> = [
      ['clientA', 'client', fx.a.clientId],
      ['contactA', 'contact', fx.a.contactId],
      ['ticketA', 'ticket', fx.a.ticketId],
      ['projectA', 'project', fx.a.projectId],
      ['taskA', 'project_task', fx.a.taskId],
      ['clientB', 'client', fx.b.clientId],
      ['ticketB', 'ticket', fx.b.ticketId],
      ['taskB', 'project_task', fx.b.taskId],
      // Kinds with no client path, and a kind nobody registered.
      ['knowledgeBase', 'knowledge_base_article', randomUUID()],
      ['workflowForm', 'workflow_form', randomUUID()],
      ['unknown', UNKNOWN_KIND, fx.a.ticketId],
      ['wrongKind', 'project', fx.a.ticketId],
      ['foreignTicket', 'ticket', fx.foreignTicketId],
    ];
    for (const [label, type, id] of targets) {
      const tagId = randomUUID();
      await ctx.db('tag_definitions').insert({ tenant: ctx.tenantId, tag_id: tagId, tag_text: `tag-${label}`, tagged_type: type });
      const mappingId = randomUUID();
      mapping[label] = mappingId;
      await ctx.db('tag_mappings').insert({ tenant: ctx.tenantId, mapping_id: mappingId, tag_id: tagId, tagged_id: id, tagged_type: type });
    }
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await dropForeignTenant(ctx.db, fx);
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  const resolve = (type: string, id: string) =>
    clientResolvers.resolveClient(ctx.db, ctx.tenantId, 'tagged_entity', type, id);
  const allowed = (template: PolymorphicTemplate, clientIds: string[]) =>
    polymorphicRowsAllowed(ctx.db, ctx.tenantId, { table: 'tag_mappings', alias: 'tm', pk: 'mapping_id', template, clientIds });
  const ofA = () => ['clientA', 'contactA', 'ticketA', 'projectA', 'taskA'].map((label) => mapping[label]).sort();
  const ofB = () => ['clientB', 'ticketB', 'taskB'].map((label) => mapping[label]).sort();

  it('row facet: a tag on a client, contact, ticket, project or project task resolves to the owning client', async () => {
    expect(await resolve('client', fx.a.clientId)).toBe(fx.a.clientId);
    expect(await resolve('contact', fx.a.contactId)).toBe(fx.a.clientId);
    expect(await resolve('ticket', fx.a.ticketId)).toBe(fx.a.clientId);
    expect(await resolve('project', fx.a.projectId)).toBe(fx.a.clientId);
    expect(await resolve('project_task', fx.a.taskId)).toBe(fx.a.clientId);
    expect(await resolve('ticket', fx.b.ticketId)).toBe(fx.b.clientId);
  });

  it('row facet: an unknown discriminator, kinds with no client, the wrong kind and another tenant resolve to null', async () => {
    expect(await resolve(UNKNOWN_KIND, fx.a.ticketId)).toBeNull();
    expect(await resolve('knowledge_base_article', randomUUID())).toBeNull();
    expect(await resolve('workflow_form', randomUUID())).toBeNull();
    expect(await resolve('document', randomUUID())).toBeNull();
    expect(await resolve('project', fx.a.ticketId)).toBeNull();
    expect(await resolve('ticket', fx.foreignTicketId)).toBeNull();
    expect(await resolve('client', fx.foreignClientId)).toBeNull();
  });

  it.each(TEMPLATES)('SQL facet, %s: client A returns only A\'s mappings', async (template) => {
    expect(await allowed(template, [fx.a.clientId])).toEqual(ofA());
    expect(await allowed(template, [fx.b.clientId])).toEqual(ofB());
    expect(await allowed(template, [fx.a.clientId, fx.b.clientId])).toHaveLength(8);
  });

  it.each(TEMPLATES)('SQL facet, %s: unknown, no-client, wrong-kind and cross-tenant rows never match; an empty set matches nothing', async (template) => {
    const everyone = await allowed(template, [fx.a.clientId, fx.b.clientId, fx.foreignClientId]);
    for (const label of ['knowledgeBase', 'workflowForm', 'unknown', 'wrongKind', 'foreignTicket']) {
      expect(everyone).not.toContain(mapping[label]);
    }
    expect(await allowed(template, [])).toEqual([]);
  });

  it('SQL facet, same_client: narrows to the subject\'s client', async () => {
    expect(await allowed('same_client', [fx.b.clientId])).toEqual(ofB());
  });

  it('parity: the SQL facet selects exactly the rows whose row-facet client is in the set', async () => {
    const rows = await ctx.db('tag_mappings').where({ tenant: ctx.tenantId }).select<Array<Record<string, string>>>('mapping_id', 'tagged_type', 'tagged_id');
    for (const clientId of [fx.a.clientId, fx.b.clientId]) {
      const viaRowFacet: string[] = [];
      for (const row of rows) {
        if ((await resolve(row.tagged_type, row.tagged_id)) === clientId) viaRowFacet.push(row.mapping_id);
      }
      expect(await allowed('client_portfolio', [clientId])).toEqual(viaRowFacet.sort());
    }
  });
});
