'use server';

import { createTenantKnex } from '../../db';

type FilterOption = {
  value: string;
  label: string;
};

export type SurveyFilterClient = {
  client_id: string;
  client_name: string;
  client_type: 'company' | 'individual';
  is_inactive: boolean;
  logoUrl: string | null;
};

export type SurveyFilterOptions = {
  templates: FilterOption[];
  technicians: FilterOption[];
  clients: SurveyFilterClient[];
};

const TEMPLATES_TABLE = 'survey_templates';
const RESPONSES_TABLE = 'survey_responses';
const TICKETS_TABLE = 'tickets';
const CLIENTS_TABLE = 'clients';
const USERS_TABLE = 'users';

function ensureTenant(tenant: string | null): string {
  if (!tenant) {
    throw new Error('Tenant context is required to load survey filter options');
  }
  return tenant;
}

export async function getSurveyFilterOptions(): Promise<SurveyFilterOptions> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const [templates, technicianRows, clientRows] = await Promise.all([
    knex(TEMPLATES_TABLE)
      .where({ tenant: tenantId, enabled: true })
      .select(['template_id', 'template_name'])
      .orderBy('template_name', 'asc'),
    knex(`${RESPONSES_TABLE} as sr`)
      .leftJoin(`${TICKETS_TABLE} as t`, function joinTickets() {
        this.on('sr.ticket_id', '=', 't.ticket_id').andOn('sr.tenant', '=', 't.tenant');
      })
      .leftJoin(`${USERS_TABLE} as u`, function joinUsers() {
        this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
      })
      .where('sr.tenant', tenantId)
      .whereNotNull('t.assigned_to')
      .distinct('t.assigned_to as user_id')
      .select(knex.raw("COALESCE(CONCAT(u.first_name, ' ', u.last_name), '') as full_name"))
      .orderBy('full_name', 'asc'),
    knex(`${RESPONSES_TABLE} as sr`)
      .leftJoin(`${CLIENTS_TABLE} as c`, function joinClients() {
        this.on('sr.client_id', '=', 'c.client_id').andOn('sr.tenant', '=', 'c.tenant');
      })
      .where('sr.tenant', tenantId)
      .whereNotNull('sr.client_id')
      .distinct(
        'sr.client_id as client_id',
        'c.client_name',
        'c.client_type',
        'c.is_inactive'
      )
      .orderBy('c.client_name', 'asc'),
  ]);

  return {
    templates: templates.map((template) => ({
      value: template.template_id,
      label: template.template_name,
    })),
    technicians: technicianRows
      .filter((row) => row.user_id)
      .map((row) => ({
        value: row.user_id,
        label: row.full_name?.trim() || 'Unassigned',
      })),
    clients: clientRows
      .filter((row) => row.client_id)
      .map((row) => ({
        client_id: row.client_id,
        client_name: row.client_name ?? 'Unnamed Client',
        client_type: row.client_type === 'individual' ? 'individual' : 'company',
        is_inactive: Boolean(row.is_inactive),
        logoUrl: null,
      })),
  };
}
