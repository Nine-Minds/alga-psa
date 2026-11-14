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

// T004 (document_entity). document_associations has no client column: the client is
// the owner of the entity the (entity_type, entity_id) pair points at.

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const TEMPLATES: PolymorphicTemplate[] = ['client_portfolio', 'selected_clients'];

describe('document_entity client resolver (document_associations)', () => {
  let ctx: TestContext;
  let fx: PolymorphicFixture;
  /** document_associations.association_id by label */
  const assoc: Record<string, string> = {};
  let salesOrderA: string;
  let contractA: string;

  beforeAll(async () => {
    ctx = await helpers.beforeAll();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    fx = await seedPolymorphicFixture(ctx.db, ctx.tenantId, ctx.userId);

    // Parents whose client column is not `client_id` (contracts) or that the shared fixture does not seed.
    salesOrderA = randomUUID();
    await ctx.db('sales_orders').insert({ tenant: ctx.tenantId, so_id: salesOrderA, so_number: `SO-${salesOrderA.slice(0, 8)}`, client_id: fx.a.clientId });
    contractA = randomUUID();
    await ctx.db('contracts').insert({ tenant: ctx.tenantId, contract_id: contractA, contract_name: 'Contract A', owner_client_id: fx.a.clientId });

    const targets: Array<[string, string, string]> = [
      ['clientA', 'client', fx.a.clientId],
      ['contactA', 'contact', fx.a.contactId],
      ['ticketA', 'ticket', fx.a.ticketId],
      ['assetA', 'asset', fx.a.assetId],
      ['interactionA', 'interaction', fx.a.interactionId],
      ['salesOrderA', 'sales_order', salesOrderA],
      ['contractA', 'contract', contractA],
      ['taskA', 'project_task', fx.a.taskId],
      ['clientB', 'client', fx.b.clientId],
      ['ticketB', 'ticket', fx.b.ticketId],
      ['assetB', 'asset', fx.b.assetId],
      // Kinds with no client, and a kind nobody registered.
      ['user', 'user', ctx.userId],
      ['team', 'team', randomUUID()],
      ['tenant', 'tenant', ctx.tenantId],
      ['document', 'document', randomUUID()],
      ['wrongKind', 'asset', fx.a.ticketId],
      ['foreignTicket', 'ticket', fx.foreignTicketId],
    ];
    for (const [label, type, id] of targets) {
      const documentId = randomUUID();
      await ctx.db('documents').insert({ tenant: ctx.tenantId, document_id: documentId, document_name: `doc-${label}`, user_id: ctx.userId, created_by: ctx.userId });
      const [row] = await ctx.db('document_associations')
        .insert({ tenant: ctx.tenantId, document_id: documentId, entity_id: id, entity_type: type })
        .returning('association_id');
      assoc[label] = String(row.association_id);
    }
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await dropForeignTenant(ctx.db, fx);
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  const resolve = (type: string, id: string) =>
    clientResolvers.resolveClient(ctx.db, ctx.tenantId, 'document_entity', type, id);
  const allowed = (template: PolymorphicTemplate, clientIds: string[]) =>
    polymorphicRowsAllowed(ctx.db, ctx.tenantId, { table: 'document_associations', alias: 'da', pk: 'association_id', template, clientIds });
  const ofA = () => ['clientA', 'contactA', 'ticketA', 'assetA', 'interactionA', 'salesOrderA', 'contractA', 'taskA'].map((label) => assoc[label]).sort();
  const ofB = () => ['clientB', 'ticketB', 'assetB'].map((label) => assoc[label]).sort();

  it('row facet: a document on a client, contact, ticket, asset, interaction, sales order, contract or project task resolves to the owning client', async () => {
    expect(await resolve('client', fx.a.clientId)).toBe(fx.a.clientId);
    expect(await resolve('contact', fx.a.contactId)).toBe(fx.a.clientId);
    expect(await resolve('ticket', fx.a.ticketId)).toBe(fx.a.clientId);
    expect(await resolve('asset', fx.a.assetId)).toBe(fx.a.clientId);
    expect(await resolve('interaction', fx.a.interactionId)).toBe(fx.a.clientId);
    expect(await resolve('sales_order', salesOrderA)).toBe(fx.a.clientId);
    expect(await resolve('contract', contractA)).toBe(fx.a.clientId);
    expect(await resolve('project_task', fx.a.taskId)).toBe(fx.a.clientId);
    expect(await resolve('asset', fx.b.assetId)).toBe(fx.b.clientId);
  });

  it('row facet: an unknown discriminator, kinds with no client, the wrong kind and another tenant resolve to null', async () => {
    expect(await resolve(UNKNOWN_KIND, fx.a.ticketId)).toBeNull();
    expect(await resolve('user', ctx.userId)).toBeNull();
    expect(await resolve('team', randomUUID())).toBeNull();
    expect(await resolve('tenant', ctx.tenantId)).toBeNull();
    expect(await resolve('asset', fx.a.ticketId)).toBeNull();
    expect(await resolve('ticket', fx.foreignTicketId)).toBeNull();
  });

  it.each(TEMPLATES)('SQL facet, %s: client A returns only A\'s associations', async (template) => {
    expect(await allowed(template, [fx.a.clientId])).toEqual(ofA());
    expect(await allowed(template, [fx.b.clientId])).toEqual(ofB());
    expect(await allowed(template, [fx.a.clientId, fx.b.clientId])).toHaveLength(11);
  });

  it.each(TEMPLATES)('SQL facet, %s: no-client, wrong-kind and cross-tenant rows never match; an empty set matches nothing', async (template) => {
    const everyone = await allowed(template, [fx.a.clientId, fx.b.clientId, fx.foreignClientId]);
    for (const label of ['user', 'team', 'tenant', 'document', 'wrongKind', 'foreignTicket']) {
      expect(everyone).not.toContain(assoc[label]);
    }
    expect(await allowed(template, [])).toEqual([]);
  });

  it('SQL facet, same_client: narrows to the subject\'s client', async () => {
    expect(await allowed('same_client', [fx.b.clientId])).toEqual(ofB());
  });

  it('parity: the SQL facet selects exactly the rows whose row-facet client is in the set', async () => {
    const rows = await ctx.db('document_associations').where({ tenant: ctx.tenantId }).select<Array<Record<string, string>>>('association_id', 'entity_type', 'entity_id');
    for (const clientId of [fx.a.clientId, fx.b.clientId]) {
      const viaRowFacet: string[] = [];
      for (const row of rows) {
        if ((await resolve(row.entity_type, row.entity_id)) === clientId) viaRowFacet.push(String(row.association_id));
      }
      expect(await allowed('client_portfolio', [clientId])).toEqual(viaRowFacet.sort());
    }
  });
});
