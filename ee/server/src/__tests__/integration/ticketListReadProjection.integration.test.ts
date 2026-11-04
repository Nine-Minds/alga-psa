import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { loadTicketRowsByReadTargets } from '../../../../../packages/tickets/src/actions/optimizedTicketActions';

const TENANT = '72000000-0000-4000-8000-000000000001';
const RESTRICTED = '72000000-0000-4000-8000-000000000011';
const VISIBLE = '72000000-0000-4000-8000-000000000012';
const DENIED = '72000000-0000-4000-8000-000000000013';
const WILDCARD = '72000000-0000-4000-8000-000000000014';
const PRIORITY_COLOR_CANONICAL = '72000000-0000-4000-8000-000000000015';
const PRIORITY_COLOR_ALIAS = '72000000-0000-4000-8000-000000000016';

describe('ticket list and hydration SQL projection', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('loads mixed redaction groups with masked SQL values and omits denied or whole-resource rows', async () => {
    const trx = await db.transaction();
    try {
      await trx.raw(`
        CREATE TEMP TABLE tickets (
          ticket_id uuid, ticket_number text, title text, url text, board_id uuid, client_id uuid,
          location_id uuid, contact_name_id uuid, status_id uuid, category_id uuid, subcategory_id uuid,
          priority_id uuid, entered_by uuid, updated_by uuid, closed_by uuid, assigned_to uuid,
          assigned_team_id uuid, billing_profile_id uuid, entered_at timestamptz, updated_at timestamptz,
          closed_at timestamptz, due_date timestamptz, is_closed boolean, attributes jsonb,
          master_ticket_id uuid, tenant uuid, itil_impact integer, itil_urgency integer,
          itil_priority_level integer, response_state text, ticket_origin text, sla_policy_id uuid,
          sla_started_at timestamptz, sla_response_due_at timestamptz, sla_response_at timestamptz,
          sla_response_met boolean, sla_resolution_due_at timestamptz, sla_resolution_at timestamptz,
          sla_resolution_met boolean, sla_paused_at timestamptz, sla_total_pause_minutes integer
        ) ON COMMIT DROP;
        CREATE TEMP TABLE statuses (tenant uuid, status_id uuid, name text, is_closed boolean) ON COMMIT DROP;
        CREATE TEMP TABLE priorities (tenant uuid, priority_id uuid, item_type text, priority_name text, color text) ON COMMIT DROP;
        CREATE TEMP TABLE boards (tenant uuid, board_id uuid, board_name text) ON COMMIT DROP;
        CREATE TEMP TABLE categories (tenant uuid, category_id uuid, category_name text) ON COMMIT DROP;
        CREATE TEMP TABLE clients (tenant uuid, client_id uuid, client_name text) ON COMMIT DROP;
        CREATE TEMP TABLE contacts (tenant uuid, contact_name_id uuid, full_name text) ON COMMIT DROP;
        CREATE TEMP TABLE users (tenant uuid, user_id uuid, first_name text, last_name text) ON COMMIT DROP;
        CREATE TEMP TABLE teams (tenant uuid, team_id uuid, team_name text) ON COMMIT DROP;
        CREATE TEMP TABLE ticket_resources (tenant uuid, ticket_id uuid, additional_user_id uuid) ON COMMIT DROP;
        CREATE TEMP TABLE tag_mappings (tenant uuid, tagged_type text, tagged_id uuid, tag_id uuid) ON COMMIT DROP;
        CREATE TEMP TABLE tag_display_rules (tenant uuid, tag_id uuid, tagged_type text, audience text, position integer) ON COMMIT DROP;
        CREATE TEMP TABLE tag_definitions (tenant uuid, tag_id uuid, tag_text text, background_color text, text_color text) ON COMMIT DROP;
      `);
      const ids = {
        board: '72000000-0000-4000-8000-000000000021',
        client: '72000000-0000-4000-8000-000000000022',
        status: '72000000-0000-4000-8000-000000000023',
        category: '72000000-0000-4000-8000-000000000024',
        priority: '72000000-0000-4000-8000-000000000025',
        contact: '72000000-0000-4000-8000-000000000026',
        enteredBy: '72000000-0000-4000-8000-000000000027',
        assignee: '72000000-0000-4000-8000-000000000028',
        team: '72000000-0000-4000-8000-000000000029',
      };
      await trx('statuses').insert({ tenant: TENANT, status_id: ids.status, name: 'SECRET STATUS', is_closed: true });
      await trx('priorities').insert({ tenant: TENANT, priority_id: ids.priority, item_type: 'ticket', priority_name: 'SECRET PRIORITY', color: 'SECRET PRIORITY COLOR' });
      await trx('boards').insert({ tenant: TENANT, board_id: ids.board, board_name: 'SECRET BOARD' });
      await trx('categories').insert({ tenant: TENANT, category_id: ids.category, category_name: 'SECRET CATEGORY' });
      await trx('clients').insert({ tenant: TENANT, client_id: ids.client, client_name: 'SECRET CLIENT' });
      await trx('contacts').insert({ tenant: TENANT, contact_name_id: ids.contact, full_name: 'SECRET CONTACT' });
      await trx('users').insert([
        { tenant: TENANT, user_id: ids.enteredBy, first_name: 'SECRET', last_name: 'ENTERER' },
        { tenant: TENANT, user_id: ids.assignee, first_name: 'SECRET', last_name: 'ASSIGNEE' },
      ]);
      await trx('teams').insert({ tenant: TENANT, team_id: ids.team, team_name: 'SECRET TEAM' });
      await trx('tickets').insert([RESTRICTED, VISIBLE, DENIED, WILDCARD, PRIORITY_COLOR_CANONICAL, PRIORITY_COLOR_ALIAS].map((ticket_id, index) => ({
        ticket_id,
        tenant: TENANT,
        ticket_number: `SECRET NUMBER ${index}`,
        title: `SECRET TITLE ${index}`,
        url: `SECRET URL ${index}`,
        board_id: ids.board,
        client_id: ids.client,
        contact_name_id: ids.contact,
        status_id: ids.status,
        category_id: ids.category,
        priority_id: ids.priority,
        entered_by: ids.enteredBy,
        assigned_to: ids.assignee,
        assigned_team_id: ids.team,
        due_date: new Date('2026-03-01T00:00:00Z'),
        attributes: { description: `SECRET DESCRIPTION ${index}`, private_value: `SECRET ATTRIBUTE ${index}` },
      })));

      const base = tenantDb(trx, TENANT).scoped('tickets as t').builder;
      const scoped = tenantDb(trx, TENANT);
      for (const [table, left, right] of [
        ['tickets as mt', 't.master_ticket_id', 'mt.ticket_id'],
        ['statuses as s', 't.status_id', 's.status_id'],
        ['priorities as p', 't.priority_id', 'p.priority_id'],
        ['boards as c', 't.board_id', 'c.board_id'],
        ['categories as cat', 't.category_id', 'cat.category_id'],
        ['clients as comp', 't.client_id', 'comp.client_id'],
        ['contacts as cn', 't.contact_name_id', 'cn.contact_name_id'],
        ['users as u', 't.entered_by', 'u.user_id'],
        ['users as au', 't.assigned_to', 'au.user_id'],
        ['teams as tm', 't.assigned_team_id', 'tm.team_id'],
      ]) scoped.tenantJoin(base, table, left, right, { type: 'left' });

      const rows = await loadTicketRowsByReadTargets(
        trx,
        TENANT,
        base,
        'internal',
        [
          { id: RESTRICTED, redactedFields: ['ticket_number', 'url', 'entered_by', 'attributes.private_value', 'client_name', 'status_name', 'assigned_to', 'priority_name'] },
          { id: VISIBLE, redactedFields: [] },
          { id: WILDCARD, redactedFields: ['*'] },
          { id: PRIORITY_COLOR_CANONICAL, redactedFields: ['priority_color'] },
          { id: PRIORITY_COLOR_ALIAS, redactedFields: ['priorities.color'] },
        ],
        [RESTRICTED, VISIBLE, DENIED, WILDCARD, PRIORITY_COLOR_CANONICAL, PRIORITY_COLOR_ALIAS]
      );
      const byId = new Map(rows.map((row: any) => [row.ticket_id, row]));
      const restricted = byId.get(RESTRICTED);
      expect(restricted).toMatchObject({
        ticket_number: null,
        url: null,
        entered_by: null,
        title: 'SECRET TITLE 0',
        attributes: null,
        client_name: null,
        status_name: null,
        is_closed: null,
        assigned_to: null,
        assigned_to_name: null,
        priority_name: null,
        priority_color: null,
        bundle_child_count: null,
        bundle_open_child_count: null,
        bundle_distinct_client_count: null,
        bundle_master_ticket_number: null,
        contact_tags: [],
        client_tags: [],
        __ticket_read_has_redactions: true,
      });
      expect(byId.get(VISIBLE)).toMatchObject({
        ticket_number: 'SECRET NUMBER 1',
        url: 'SECRET URL 1',
        entered_by: ids.enteredBy,
        attributes: { description: 'SECRET DESCRIPTION 1', private_value: 'SECRET ATTRIBUTE 1' },
        client_name: 'SECRET CLIENT',
        status_name: 'SECRET STATUS',
        assigned_to_name: 'SECRET ASSIGNEE',
      });
      expect(byId.has(DENIED)).toBe(false);
      expect(byId.has(WILDCARD)).toBe(false);
      expect(byId.get(PRIORITY_COLOR_CANONICAL)).toMatchObject({
        priority_color: null,
        priority_name: 'SECRET PRIORITY',
      });
      expect(byId.get(PRIORITY_COLOR_ALIAS)).toMatchObject({
        priority_color: null,
        priority_name: 'SECRET PRIORITY',
      });
    } finally {
      await trx.rollback();
    }
  });
});
