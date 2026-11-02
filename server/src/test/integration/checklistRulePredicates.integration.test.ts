import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { createRequire } from 'node:module';
import { tenantDb } from '@alga-psa/db';
import {
  matchingRuleTemplateIds,
  applyMatchingChecklistTemplates,
} from '@alga-psa/shared/lib/ticketChecklists';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { silentTicketCreation } from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';
import {
  ruleMatchesTicket,
  ticketDescriptionToPlainText,
  type ChecklistApplyRuleMatchers,
  type ChecklistRuleTicketInput,
} from '../../../../shared/lib/ticketChecklists/__tests__/fixtures/legacyRuleMatcher';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createCloseRulesFixture, insertTicket, type CloseRulesFixture } from './helpers/closeRulesFixture';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261028120000_checklist_rule_predicates.cjs');

let db: Knex;
let base: CloseRulesFixture;
const scoped = (table: string, conn: Knex | Knex.Transaction = db) =>
  tenantDb(conn, base.tenantId).table(table);
const emptyRule: ChecklistApplyRuleMatchers = {
  board_id: null,
  category_id: null,
  subcategory_id: null,
  priority_id: null,
};

async function template(name: string) {
  const id = uuid();
  await scoped('checklist_templates').insert({
    tenant: base.tenantId,
    template_id: id,
    name,
    is_active: true,
  });
  await scoped('checklist_template_items').insert({
    tenant: base.tenantId,
    template_id: id,
    item_name: name,
    is_required: false,
    order_number: 0,
  });
  return id;
}

async function category(name: string, parent?: string) {
  const id = uuid();
  await scoped('categories').insert({
    tenant: base.tenantId,
    category_id: id,
    category_name: name,
    board_id: base.boardId,
    parent_category: parent ?? null,
    created_by: base.userId,
  });
  return id;
}

async function definition() {
  const id = uuid(),
    version = uuid();
  await scoped('service_request_definitions').insert({
    tenant: base.tenantId,
    definition_id: id,
    name: 'Equivalence request',
  });
  await scoped('service_request_definition_versions').insert({
    tenant: base.tenantId,
    version_id: version,
    definition_id: id,
    version_number: 1,
    name: 'Equivalence request',
    form_schema_snapshot: '{}',
    execution_provider: 'ticket-only',
    form_behavior_provider: 'basic',
    visibility_provider: 'all-authenticated-client-users',
  });
  return { id, version };
}

async function submission(ticketId: string, request: { id: string; version: string }) {
  await scoped('service_request_submissions').insert({
    tenant: base.tenantId,
    definition_id: request.id,
    definition_version_id: request.version,
    client_id: base.clientId,
    request_name: 'Equivalence',
    submitted_payload: '{}',
    created_ticket_id: ticketId,
  });
}

async function createLegacyRuleTable(trx: Knex.Transaction) {
  await trx.schema.createTable('checklist_template_apply_rules', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('apply_rule_id').primary();
    table.uuid('template_id');
    table.boolean('is_enabled').defaultTo(true);
    table.timestamp('created_at').defaultTo(trx.fn.now());
    for (const column of [
      'board_id',
      'category_id',
      'subcategory_id',
      'priority_id',
      'service_request_definition_id',
    ])
      table.uuid(column);
    table.specificType('client_ids', 'uuid[]');
    table.specificType('ticket_origins', 'text[]');
    table.boolean('from_service_request');
    table.specificType('keywords', 'text[]');
    table.text('keyword_mode');
    table.text('keyword_target');
  });
}

describe('checklist persisted predicates', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    const user = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'seeded internal user for predicate integration fixtures')
      .where({ user_type: 'internal' })
      .first();
    base = await createCloseRulesFixture(db, user.tenant, user.user_id);
  }, 600_000);
  afterAll(async () => {
    await db?.destroy();
  });

  it('keeps legacy rule reads and writes working after upgrade and preserves predicate edits on rerun', async () => {
    const trx = await db.transaction();
    try {
      const schema = `checklist_upgrade_${uuid().replaceAll('-', '')}`;
      await trx.raw('CREATE SCHEMA ??', [schema]);
      await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
      await createLegacyRuleTable(trx);
      const legacy = {
        board_id: base.boardId,
        category_id: uuid(),
        subcategory_id: uuid(),
        priority_id: base.priorityId,
        client_ids: [base.clientId],
        ticket_origins: ['api'],
        from_service_request: true,
        service_request_definition_id: uuid(),
        keywords: ['Onboarding', 'Laptop'],
        keyword_mode: 'all',
        keyword_target: 'title_and_description',
      };
      const key = { tenant: base.tenantId, apply_rule_id: uuid() };
      await trx('checklist_template_apply_rules').insert({ ...key, ...legacy });
      await migration.up(trx);

      // The previous release selects these fields explicitly in rule CRUD.
      expect(await trx('checklist_template_apply_rules').where(key).first(...Object.keys(legacy)))
        .toEqual(legacy);
      const [updated] = await trx('checklist_template_apply_rules').where(key)
        .update({ ...legacy, keywords: ['Replacement'] }).returning(Object.keys(legacy));
      expect(updated).toEqual({ ...legacy, keywords: ['Replacement'] });
      const insertedKey = { tenant: base.tenantId, apply_rule_id: uuid() };
      const [inserted] = await trx('checklist_template_apply_rules')
        .insert({ ...insertedKey, ...legacy }).returning(Object.keys(legacy));
      expect(inserted).toEqual(legacy);

      // Retaining legacy columns must not make recovery tooling backfill over newer edits.
      const predicate = { join: 'or', clauses: [
        { path: 'client.tags', operator: 'in', value: [uuid()] },
        { path: 'priority_id', operator: 'equals', value: base.priorityId },
      ] };
      await trx('checklist_template_apply_rules').where(key).update({ where: JSON.stringify(predicate) });
      await migration.up(trx);
      expect((await trx('checklist_template_apply_rules').where(key).first('where')).where)
        .toEqual(predicate);
      expect(await trx('checklist_template_apply_rules').where(insertedKey).first(...Object.keys(legacy)))
        .toEqual(legacy);
    } finally {
      await trx.rollback();
    }
  });

  it('migrates more than one backfill batch without losing rules and can be invoked again', async () => {
    const trx = await db.transaction();
    try {
      const schema = `checklist_batch_${uuid().replaceAll('-', '')}`;
      await trx.raw('CREATE SCHEMA ??', [schema]);
      await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
      await createLegacyRuleTable(trx);
      const rows = Array.from({ length: 501 }, (_, index) => ({
        tenant: index % 2 ? base.tenantId : uuid(), apply_rule_id: uuid(),
        keywords: [` KEYWORD ${index} `], keyword_target: 'title',
      }));
      await trx('checklist_template_apply_rules').insert(rows);
      await migration.up(trx);
      const expected = new Map(rows.map((row, index) => [row.apply_rule_id, `keyword ${index}`]));
      const migrated = await trx('checklist_template_apply_rules').select('*').orderBy('apply_rule_id');
      expect(migrated).toHaveLength(501);
      for (const row of migrated) {
        expect(row.where_version).toBe(1);
        expect(row.where).toEqual({ join: 'and', clauses: [{ join: 'or', clauses: [
          { path: 'title_folded', operator: 'contains', value: expected.get(row.apply_rule_id) },
        ] }] });
      }
      await migration.up(trx);
      expect(await trx('checklist_template_apply_rules').select('*').orderBy('apply_rule_id')).toEqual(migrated);
    } finally {
      await trx.rollback();
    }
  });

  it('migrates every legacy dimension and keyword combination and proves the SQL truth table against seeded tickets', async () => {
    const other = await createCloseRulesFixture(db, base.tenantId, base.userId);
    const cat = await category('New User');
    const sub = await category('Laptop', cat);
    const request = await definition();
    const secondRequest = await definition();
    const defaultTicket = {
      board_id: base.boardId,
      category_id: cat,
      subcategory_id: sub,
      priority_id: base.priorityId,
      client_id: base.clientId,
      ticket_origin: 'api',
      title: 'Onboarding Jane',
      description: 'Laptop setup',
      fromServiceRequest: false,
      serviceRequestDefinitionId: null,
    };
    const cases: Array<Partial<ChecklistRuleTicketInput> & { rich?: unknown }> = [
      {},
      { board_id: other.boardId, priority_id: other.priorityId, client_id: other.clientId },
      { category_id: null, subcategory_id: null, ticket_origin: null },
      { title: 'Unrelated', description: 'Unrelated' },
      { title: 'Jane', description: 'onboarding laptop' },
      { title: null, description: null },
      {
        title: 'Onboarding',
        description: 'Laptop',
        fromServiceRequest: true,
        serviceRequestDefinitionId: request.id,
      },
      { fromServiceRequest: true, serviceRequestDefinitionId: secondRequest.id },
      { title: 'a%_\\b on.*ing', description: 'Literal symbols' },
      { title: 'İ ΟΣ ΟΣΑ ÉCOLE 𐐀' },
      {
        rich: [
          {
            type: 'paragraph',
            props: { alignment: 'left' },
            content: [
              { type: 'text', text: 'Onbo' },
              { type: 'text', text: 'arding laptop' },
            ],
          },
        ],
      },
      {
        rich: JSON.stringify([
          {
            type: 'paragraph',
            props: { alignment: 'left' },
            content: [{ type: 'text', text: 'Onboarding laptop' }],
          },
        ]),
      },
      {
        rich: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Onboarding laptop' }] }],
        },
      },
      {
        rich: [
          { type: 'paragraph', content: [{ type: 'mention', props: { username: 'jane' } }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'laptop' }] },
        ],
      },
    ];
    const tickets: Array<{ id: string; value: ChecklistRuleTicketInput }> = [];
    for (const over of cases) {
      const value = { ...defaultTicket, ...over };
      const description = over.rich === undefined ? value.description : over.rich;
      const selectedFixture = value.board_id === other.boardId ? other : base;
      const id = await insertTicket(db, selectedFixture, {
        title: value.title ?? 'temporary',
        category_id: value.category_id,
        subcategory_id: value.subcategory_id,
        attributes: JSON.stringify({ description }),
      } as any);
      await scoped('tickets')
        .where({ ticket_id: id })
        .update({
          title: value.title ?? '',
          ticket_origin: value.ticket_origin,
          client_id: value.client_id,
          priority_id: value.priority_id,
        });
      if (value.fromServiceRequest)
        await submission(id, value.serviceRequestDefinitionId === request.id ? request : secondRequest);
      tickets.push({
        id,
        value: { ...value, title: value.title ?? '', description: ticketDescriptionToPlainText(description) },
      });
    }
    const shapes: Array<Partial<ChecklistApplyRuleMatchers>> = [
      {},
      { client_ids: [], ticket_origins: [], keywords: [' ', ''], from_service_request: false },
      { board_id: base.boardId },
      { board_id: other.boardId },
      { category_id: cat },
      { subcategory_id: sub },
      { priority_id: base.priorityId },
      { client_ids: [base.clientId] },
      { client_ids: [base.clientId, other.clientId] },
      { ticket_origins: ['api', 'inbound_email'] },
      { from_service_request: true },
      { service_request_definition_id: request.id },
      { from_service_request: false, service_request_definition_id: secondRequest.id },
      {
        board_id: base.boardId,
        category_id: cat,
        subcategory_id: sub,
        priority_id: base.priorityId,
        client_ids: [base.clientId],
        ticket_origins: ['api'],
        service_request_definition_id: request.id,
        keywords: ['onboarding'],
        keyword_target: 'title',
      },
      ...(['any', 'all'] as const).flatMap((keyword_mode) =>
        (['title', 'description', 'title_and_description'] as const).map((keyword_target) => ({
          keywords: ['  ONBOARDING ', 'laptop'],
          keyword_mode,
          keyword_target,
        }))
      ),
      { keywords: ['paragraph', 'alignment', 'left'] },
      { keywords: ['on.*ing'] },
      { keywords: ['a%_\\b'] },
      { keywords: ['İ'] },
      { keywords: ['ΟΣ'] },
      { keywords: ['ΟΣΑ'] },
      { keywords: ['ÉCOLE', '𐐀'], keyword_mode: 'all' },
      { keywords: ['@jane'] },
      { keywords: ['janelaptop'] },
      { keywords: ['missing'], keyword_mode: null, keyword_target: null },
    ];
    const rules = await Promise.all(
      shapes.map(async (shape, index) => ({
        rule: { ...emptyRule, ...shape },
        templateId: await template(`Legacy matrix ${index}`),
      }))
    );
    const trx = await db.transaction();
    try {
      // Run the real migration against an old-format table in an isolated schema, then evaluate it
      // against the seeded public tickets. Public tables are never downgraded by this test.
      const schema = `checklist_migration_${uuid().replaceAll('-', '')}`;
      await trx.raw('CREATE SCHEMA ??', [schema]);
      await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
      await createLegacyRuleTable(trx);
      for (const { rule, templateId } of rules)
        await trx('checklist_template_apply_rules').insert({
          tenant: base.tenantId,
          apply_rule_id: uuid(),
          template_id: templateId,
          ...rule,
        });
      await migration.up(trx);
      const stored = await trx('checklist_template_apply_rules').select('where', 'where_version').orderBy('apply_rule_id');
      await migration.up(trx);
      expect(await trx('checklist_template_apply_rules').select('where', 'where_version').orderBy('apply_rule_id')).toEqual(stored);
      expect(stored).toHaveLength(rules.length);
      expect(stored.every((rule) => rule.where_version === 1)).toBe(true);
      for (const ticket of tickets) {
        const queries: unknown[] = [];
        const observe = (query: unknown) => {
          queries.push(query);
        };
        trx.on('query', observe);
        const actual = await matchingRuleTemplateIds(trx, base.tenantId, ticket.id);
        trx.removeListener('query', observe);
        expect(queries).toHaveLength(2); // one rule load and one evaluation, independent of rule count
        const expected = rules
          .filter(({ rule }) => ruleMatchesTicket(rule, ticket.value))
          .map(({ templateId }) => templateId);
        expect(actual.sort(), `Legacy rule matrix for ticket ${ticket.id}`).toEqual(expected.sort());
      }
      const bad = await trx('checklist_template_apply_rules').first('apply_rule_id');
      await trx('checklist_template_apply_rules').where(bad).update({ where_version: 999 });
      await expect(matchingRuleTemplateIds(trx, base.tenantId, tickets[0].id)).rejects.toMatchObject({
        name: 'UnsupportedRuleVersionError',
      });
    } finally {
      await trx.rollback();
    }
  }, 120_000);

  it('auto-applies client-tag AND category AND title targeting only to matching tickets, with independent contact tags and no child expansion', async () => {
    const cat = await category('Tag targeting New User');
    const otherCat = await category('Other');
    const managedTag = uuid(),
      contactTag = uuid();
    await scoped('tag_definitions').insert([
      { tenant: base.tenantId, tag_id: managedTag, tag_text: 'Managed M365', tagged_type: 'client' },
      { tenant: base.tenantId, tag_id: contactTag, tag_text: 'Managed M365', tagged_type: 'contact' },
    ]);
    const contactOnly = await createCloseRulesFixture(db, base.tenantId, base.userId);
    await scoped('tag_mappings').insert([
      { tenant: base.tenantId, tag_id: managedTag, tagged_id: base.clientId, tagged_type: 'client' },
      { tenant: base.tenantId, tag_id: contactTag, tagged_id: contactOnly.contactId, tagged_type: 'contact' },
    ]);
    const clientTemplate = await template('Managed M365 onboarding');
    const contactTemplate = await template('Contact onboarding');
    const noneTemplate = await template('No managed tag');
    const prefix = [
      { path: 'category_id', operator: 'equals', value: cat },
      { path: 'title_folded', operator: 'contains', value: 'onboarding' },
    ];
    await scoped('checklist_template_apply_rules').insert([
      {
        tenant: base.tenantId,
        template_id: clientTemplate,
        where: JSON.stringify({
          join: 'and',
          clauses: [{ path: 'client.tags', operator: 'in', value: [managedTag] }, ...prefix],
        }),
      },
      {
        tenant: base.tenantId,
        template_id: contactTemplate,
        where: JSON.stringify({
          join: 'and',
          clauses: [{ path: 'contact.tags', operator: 'in', value: [contactTag] }, ...prefix],
        }),
      },
      {
        tenant: base.tenantId,
        template_id: noneTemplate,
        where: JSON.stringify({
          join: 'and',
          clauses: [{ path: 'client.tags', operator: 'not_in', value: [managedTag] }, ...prefix],
        }),
      },
    ]);
    const create = async (client: CloseRulesFixture, title: string, categoryId = cat) =>
      db.transaction(async (trx) => {
        const ticket = await TicketModel.createTicket(
          {
            title,
            board_id: base.boardId,
            client_id: client.clientId,
            contact_id: client.contactId,
            category_id: categoryId,
            status_id: base.openStatusId,
            priority_id: base.priorityId,
            entered_by: base.userId,
          } as any,
          base.tenantId,
          trx,
          { skipLocationValidation: true, skipCategoryValidation: true, skipSubcategoryValidation: true },
          silentTicketCreation('predicate targeting test'),
          undefined,
          base.userId
        );
        const ids = (
          await scoped('ticket_checklist_items', trx)
            .where({ ticket_id: ticket.ticket_id })
            .select('template_id')
        ).map((row: any) => row.template_id);
        return { id: ticket.ticket_id, ids };
      });
    const match = await create(base, 'OnBoarding Jane');
    expect(match.ids).toContain(clientTemplate);
    expect(match.ids).not.toContain(contactTemplate);
    expect(match.ids).not.toContain(noneTemplate);
    const contactMatch = await create(contactOnly, 'Onboarding John');
    expect(contactMatch.ids).not.toContain(clientTemplate);
    expect(contactMatch.ids).toContain(contactTemplate);
    expect(contactMatch.ids).toContain(noneTemplate);
    for (const negative of [await create(base, 'Other task'), await create(base, 'Onboarding', otherCat)]) {
      expect(negative.ids).not.toContain(clientTemplate);
      expect(negative.ids).not.toContain(contactTemplate);
    }
    await db.transaction(async (trx) => {
      await applyMatchingChecklistTemplates(trx, base.tenantId, { ticket_id: match.id });
      expect(
        await scoped('ticket_checklist_items', trx).where({
          ticket_id: match.id,
          template_id: clientTemplate,
        })
      ).toHaveLength(1);
    });
    const parent = await create(contactOnly, 'Onboarding master');
    await scoped('tickets').where({ ticket_id: match.id }).update({ master_ticket_id: parent.id });
    const matched = await db.transaction((trx) => matchingRuleTemplateIds(trx, base.tenantId, parent.id));
    expect(matched).not.toContain(clientTemplate);
  });

  it('does not match a tag mapping belonging to another tenant even with identical ids', async () => {
    const otherTenant = uuid(),
      tag = uuid();
    await tenantDb(db, otherTenant)
      .unscoped('tenants', 'isolated tenant fixture')
      .insert({ tenant: otherTenant, client_name: 'Foreign tag owner', email: 'foreign@example.com' });
    await tenantDb(db, otherTenant)
      .table('tag_definitions')
      .insert({ tenant: otherTenant, tag_id: tag, tag_text: 'Foreign only', tagged_type: 'client' });
    await tenantDb(db, otherTenant)
      .table('tag_mappings')
      .insert({ tenant: otherTenant, tag_id: tag, tagged_id: base.clientId, tagged_type: 'client' });
    const templateId = await template('Tenant isolation');
    await scoped('checklist_template_apply_rules').insert({
      tenant: base.tenantId,
      template_id: templateId,
      where: JSON.stringify({
        join: 'and',
        clauses: [{ path: 'client.tags', operator: 'in', value: [tag] }],
      }),
    });
    const id = await insertTicket(db, base);
    expect(await db.transaction((trx) => matchingRuleTemplateIds(trx, base.tenantId, id))).not.toContain(
      templateId
    );
  });
});
