import type { Knex } from 'knex';
import type { TagDisplayAudience } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import type { TicketReadScope } from '@alga-psa/authorization/ticketScopeAuthorization';
import { displayTagsForEntityQuery } from '@alga-psa/tags/lib/displayTagsQuery';
import { ticketLatestActivitySql } from '../actions/ticketListSortSql';
import { ticketReadFieldHidden, ticketReadMask, ticketRedactionKey } from './ticketReadRedaction';

// Internal database projection, not a server action. Callers authorize targets
// before entering this layer; the transaction and query never come from clients.
export interface TicketReadTarget {
  id: string;
  redactedFields: string[];
}

export async function loadTicketRowsByReadTargets(
  trx: Knex.Transaction,
  tenant: string,
  baseQuery: Knex.QueryBuilder,
  audience: TagDisplayAudience,
  targets: TicketReadTarget[],
  orderedIds: string[],
  childScope?: TicketReadScope
): Promise<any[]> {
  const groups = new Map<string, { redactedFields: string[]; ids: string[] }>();
  for (const target of targets) {
    const key = ticketRedactionKey(target.redactedFields);
    const group = groups.get(key) ?? { redactedFields: target.redactedFields, ids: [] };
    group.ids.push(target.id);
    groups.set(key, group);
  }
  const loaded: any[] = [];
  for (const group of groups.values()) {
    const mask = ticketReadMask(group.redactedFields);
    if (mask.dropResource) continue;
    const rows = await buildTicketListItemsQuery(trx, tenant, baseQuery.clone(), audience, group.redactedFields, childScope)
      .whereIn('t.ticket_id', group.ids)
      .clearOrder();
    loaded.push(...rows);
  }
  const byId = new Map(loaded.map((row) => [row.ticket_id, row] as const));
  return orderedIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}


export function buildTicketListItemsQuery(
  trx: Knex.Transaction,
  tenant: string,
  baseQuery: Knex.QueryBuilder,
  audience: TagDisplayAudience,
  redactedFields: readonly string[] = [],
  childScope?: TicketReadScope
): Knex.QueryBuilder {
  const mask = ticketReadMask(redactedFields);
  const ticketColumn = (name: string, type = 'text') => {
    if (mask.dropResource) return trx.raw(`NULL::${type} as ??`, [name]);
    if (!ticketReadFieldHidden(redactedFields, name)) return `t.${name}`;
    if (name === 'title') return trx.raw('?::text as ??', ['Restricted ticket', name]);
    return trx.raw('CASE WHEN FALSE THEN ?? END as ??', [`t.${name}`, name]);
  };
  const joined = (expression: string, name: string, type = 'text', field?: string) =>
    mask.dropResource || (field ? ticketReadFieldHidden(redactedFields, field) : mask.redactDerived)
      ? trx.raw(`NULL::${type} as ??`, [name])
      : trx.raw(`${expression} as ??`, [name]);
  const db = tenantDb(trx, tenant);
  const latestActivity = ticketLatestActivitySql(tenant);
  const rawBundleStats = db.table('tickets as tc')
    .select(
      'tc.master_ticket_id',
      'tc.tenant',
      trx.raw('COUNT(*)::int as bundle_child_count'),
      trx.raw('COUNT(*) FILTER (WHERE tc.closed_at IS NULL)::int as bundle_open_child_count'),
      trx.raw('array_agg(DISTINCT tc.client_id) FILTER (WHERE tc.client_id IS NOT NULL) as child_client_ids')
    )
    .whereNotNull('tc.master_ticket_id');
  const bundleStats = childScope ? childScope.apply(rawBundleStats, 'tc') : rawBundleStats;
  bundleStats
    .groupBy('tc.master_ticket_id', 'tc.tenant')
    .as('bs');
  const additionalAgents = db.table('ticket_resources as tr')
    .select(
      'tr.ticket_id',
      'tr.tenant',
      trx.raw('COUNT(*) FILTER (WHERE tr.additional_user_id IS NOT NULL)::int as additional_agent_count'),
      trx.raw(`COALESCE(
        json_agg(
          json_build_object('user_id', uu.user_id, 'name', CONCAT(uu.first_name, ' ', uu.last_name))
        ) FILTER (WHERE uu.user_id IS NOT NULL),
        '[]'::json
      ) as additional_agents`)
    )
    .groupBy('tr.ticket_id', 'tr.tenant')
    .as('ags');

  db.tenantJoin(additionalAgents, 'users as uu', 'tr.additional_user_id', 'uu.user_id', {
    type: 'left',
    rootTenantColumn: 'tr.tenant',
  });

  const query = baseQuery.clone();
  db.tenantJoinSubquery(query, bundleStats, 'bs.master_ticket_id', 't.ticket_id', {
    type: 'left',
    rootTenantColumn: 't.tenant',
    joinedTenantColumn: 'bs.tenant',
  });
  db.tenantJoinSubquery(query, additionalAgents, 'ags.ticket_id', 't.ticket_id', {
    type: 'left',
    rootTenantColumn: 't.tenant',
    joinedTenantColumn: 'ags.tenant',
  });

  return query
    .select(
      // Ticket columns (explicit list avoids fetching large unused columns)
      ticketColumn('ticket_id', 'uuid'), ticketColumn('ticket_number'), ticketColumn('title'), ticketColumn('url'),
      ticketColumn('board_id', 'uuid'), ticketColumn('client_id', 'uuid'), ticketColumn('location_id', 'uuid'), ticketColumn('contact_name_id', 'uuid'),
      ticketColumn('status_id', 'uuid'), ticketColumn('category_id', 'uuid'), ticketColumn('subcategory_id', 'uuid'), ticketColumn('priority_id', 'uuid'),
      ticketColumn('entered_by', 'uuid'), ticketColumn('updated_by', 'uuid'), ticketColumn('closed_by', 'uuid'),
      ticketColumn('assigned_to', 'uuid'), ticketColumn('assigned_team_id', 'uuid'), ticketColumn('billing_profile_id', 'uuid'),
      ticketColumn('entered_at', 'timestamptz'), ticketColumn('updated_at', 'timestamptz'), ticketColumn('closed_at', 'timestamptz'), ticketColumn('due_date', 'timestamptz'),
      ticketColumn('is_closed', 'boolean'), ticketColumn('attributes', 'jsonb'),
      ticketColumn('master_ticket_id', 'uuid'), ticketColumn('tenant', 'uuid'),
      ticketColumn('itil_impact', 'integer'), ticketColumn('itil_urgency', 'integer'), ticketColumn('itil_priority_level', 'integer'),
      ticketColumn('response_state'), ticketColumn('ticket_origin'),
      ticketColumn('sla_policy_id', 'uuid'), ticketColumn('sla_started_at', 'timestamptz'),
      ticketColumn('sla_response_due_at', 'timestamptz'), ticketColumn('sla_response_at', 'timestamptz'), ticketColumn('sla_response_met', 'boolean'),
      ticketColumn('sla_resolution_due_at', 'timestamptz'), ticketColumn('sla_resolution_at', 'timestamptz'), ticketColumn('sla_resolution_met', 'boolean'),
      ticketColumn('sla_paused_at', 'timestamptz'), ticketColumn('sla_total_pause_minutes', 'integer'),
      // Bundle stats from pre-aggregated JOIN
      mask.redactDerived ? trx.raw('NULL::integer as bundle_child_count') : trx.raw('COALESCE(bs.bundle_child_count, 0) as bundle_child_count'),
      mask.redactDerived ? trx.raw('NULL::integer as bundle_open_child_count') : trx.raw('COALESCE(bs.bundle_open_child_count, 0) as bundle_open_child_count'),
      mask.redactDerived ? trx.raw('NULL::integer as bundle_distinct_client_count') : trx.raw(`COALESCE(
        (SELECT COUNT(DISTINCT cid) FROM unnest(
          array_append(COALESCE(bs.child_client_ids, ARRAY[]::uuid[]), t.client_id)
        ) AS cid WHERE cid IS NOT NULL),
        0
      )::int as bundle_distinct_client_count`),
      // Joined display columns
      joined('mt.ticket_number', 'bundle_master_ticket_number'),
      joined('s.name', 'status_name', 'text', 'status_name'),
      joined('p.priority_name', 'priority_name', 'text', 'priority_name'),
      joined('p.color', 'priority_color', 'text', 'priority_color'),
      joined('c.board_name', 'board_name', 'text', 'board_name'),
      joined('cat.category_name', 'category_name', 'text', 'category_name'),
      joined('comp.client_name', 'client_name', 'text', 'client_name'),
      joined('cn.full_name', 'contact_name', 'text', 'contact_name'),
      mask.redactDerived ? trx.raw("'[]'::json as contact_tags") : displayTagsForEntityQuery(trx, tenant, audience, 'contact', 't.contact_name_id').as('contact_tags'),
      mask.redactDerived ? trx.raw("'[]'::json as client_tags") : displayTagsForEntityQuery(trx, tenant, audience, 'client', 't.client_id').as('client_tags'),
      joined("CONCAT(u.first_name, ' ', u.last_name)", 'entered_by_name', 'text', 'entered_by'),
      joined("CONCAT(au.first_name, ' ', au.last_name)", 'assigned_to_name', 'text', 'assigned_to'),
      joined('tm.team_name', 'assigned_team_name', 'text', 'assigned_team_id'),
      joined('tloc.location_name', 'ticket_location_name', 'text', 'location_name'),
      // Additional agents from pre-aggregated JOIN
      mask.redactDerived ? trx.raw('NULL::integer as additional_agent_count') : trx.raw('COALESCE(ags.additional_agent_count, 0)::int as additional_agent_count'),
      mask.redactDerived ? trx.raw("'[]'::json as additional_agents") : trx.raw("COALESCE(ags.additional_agents, '[]'::json) as additional_agents"),
      // Same expression the latest_activity_at sort orders by, so the column
      // renders exactly the value the ordering used.
      mask.redactDerived ? trx.raw('NULL::timestamptz as latest_activity_at') : trx.raw(`${latestActivity.sql} as latest_activity_at`, latestActivity.bindings),
      ...(mask.redactDerived ? [trx.raw('TRUE as __ticket_read_has_redactions')] : []),
    );
}

