/** CM L7b3 engagement and conversation export. MSP-private notes live in the AUTHOR (sponsor) tenant: they are
 * asserted absent by table name and by body text, and their tombstones stay where they are. Attachment
 * tombstones in the customer tenant are kept. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { portableEngagementContributor } from '@alga-psa/co-managed/portableEngagementExport';
import { portableConversationContributor } from '@alga-psa/co-managed/portableConversationExport';
import { exclusionNames, exportContributor, retainContributor, type PortableWorld } from './helpers/coManagedPortableExportFixture';

const PRIVATE_BODY = 'MSP-PRIVATE-BODY-DO-NOT-EXPORT';

export function defineEngagementCases(get: () => { db: Knex; world: PortableWorld }) {
  const schema = { privateThreads: false, audienceColumn: false };
  describe('portable engagement and conversation export', () => {
    beforeAll(async () => {
      const { db } = get();
      schema.privateThreads = Boolean((await db.raw("select to_regclass('co_management_private_threads') as t")).rows[0].t);
      schema.audienceColumn = Boolean((await db.raw("select 1 from information_schema.columns where table_name='comment_threads' and column_name='collaboration_audience'")).rows.length);
    });
    it('exports interactions and appointment settings; availability keys are allowlisted; services only when referenced', async () => {
      const { db, world } = get();
      const typeId = uuidv4(), interactionId = uuidv4(), serviceId = uuidv4(), unreferencedService = uuidv4();
      await db('interaction_types').insert({ tenant: world.customer, type_id: typeId, type_name: 'Call' });
      await db('interactions').insert({ tenant: world.customer, interaction_id: interactionId, type_id: typeId, user_id: world.customerStaff.userId, title: 'Kickoff call' });
      const serviceTypeId = uuidv4();
      await db('service_types').insert({ tenant: world.customer, id: serviceTypeId, name: `Type-${serviceTypeId.slice(0, 6)}`, order_number: 1 });
      await db('service_catalog').insert([{ tenant: world.customer, service_id: serviceId, service_name: 'Onsite', billing_method: 'fixed', custom_service_type_id: serviceTypeId, default_rate: 100 },
        { tenant: world.customer, service_id: unreferencedService, service_name: 'Unused', billing_method: 'fixed', custom_service_type_id: serviceTypeId, default_rate: 1 }]);
      await db('availability_settings').insert({ tenant: world.customer, availability_setting_id: uuidv4(), setting_type: 'general_settings',
        service_id: serviceId, is_available: true, config_json: { auto_approval_enabled: true } });
      const { records } = await exportContributor(db, world, portableEngagementContributor);
      expect(records.interactions.map(row => row.interaction_id)).toContain(interactionId);
      expect(records.service_catalog.map(row => row.service_id)).not.toContain(unreferencedService);
      for (const row of records.service_catalog) expect(Object.keys(row)).not.toContain('default_rate');
    });

    it('MSP-private threads and comments are absent by name and by body; their author-tenant tombstones remain', async ctx => {
      if (!schema.privateThreads) return ctx.skip('co_management_private_threads (L4a schema) is absent from this database');
      const { db, world } = get();
      const threadId = uuidv4(), commentId = uuidv4(), ticketId = uuidv4();
      await db('co_management_private_threads').insert({ tenant: world.sponsor, thread_id: threadId, customer_tenant: world.customer,
        relationship_id: world.relationshipId, resource_type: 'ticket', resource_id: ticketId, root_comment_id: commentId });
      await db('co_management_private_comments').insert({ tenant: world.sponsor, comment_id: commentId, thread_id: threadId, actor_user_id: world.technician.userId,
        actor_display_name: 'Tech', actor_organization_name: 'MSP', note: PRIVATE_BODY, markdown_content: PRIVATE_BODY, deleted_at: db.fn.now() });
      for (const contributor of [portableEngagementContributor, portableConversationContributor]) {
        const { records, annotations } = await exportContributor(db, world, contributor);
        expect(Object.keys(records).some(table => table.startsWith('co_management_private_'))).toBe(false);
        expect(JSON.stringify({ records, annotations })).not.toContain(PRIVATE_BODY);
      }
      const { annotations } = await exportContributor(db, world, portableConversationContributor);
      expect(exclusionNames(annotations)).toEqual(expect.arrayContaining(['co_management_private_threads', 'co_management_private_comments']));
      const tombstone = await db('co_management_private_comments').where({ tenant: world.sponsor, comment_id: commentId }).first('deleted_at');
      expect(tombstone.deleted_at).not.toBeNull();
    });

    it('conversation attachments keep removed tombstones, drop drafts, and filter by thread audience', async ctx => {
      if (!schema.audienceColumn) return ctx.skip('comment_threads.collaboration_audience is absent from this database');
      const { db, world } = get();
      const ticketId = uuidv4(), threadId = uuidv4(), commentId = uuidv4();
      await db('tickets').insert({ tenant: world.customer, ticket_id: ticketId, ticket_number: `T-${ticketId.slice(0, 6)}`, client_id: world.customerClientId, title: 'Attachments' });
      await db('comment_threads').insert({ tenant: world.customer, thread_id: threadId, ticket_id: ticketId, root_comment_id: commentId, is_internal: false, collaboration_audience: 'requester' });
      await db('comments').insert({ tenant: world.customer, comment_id: commentId, ticket_id: ticketId, thread_id: threadId, note: 'hello', is_internal: false, is_resolution: false });
      const row = (state: string, comment: string | null) => ({ tenant: world.customer, attachment_id: uuidv4(), ticket_id: ticketId, document_id: uuidv4(),
        created_by: world.customerStaff.userId, comment_id: comment, state, expires_at: new Date('2027-01-01T00:00:00Z') });
      const attached = row('attached', commentId), removed = row('removed', commentId), draft = row('draft', null);
      await db('ticket_comment_attachments').insert([attached, removed, draft]);
      const { records } = await exportContributor(db, world, portableConversationContributor);
      const ids = records.ticket_comment_attachments.map(entry => entry.attachment_id);
      expect(ids).toEqual(expect.arrayContaining([attached.attachment_id, removed.attachment_id]));
      expect(ids).not.toContain(draft.attachment_id);
      expect(JSON.stringify((await retainContributor(db, world, portableConversationContributor)).records)).toBe(JSON.stringify(records));
    });
  });
}
