'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

type FilterOption = {
  value: string;
  label: string;
};

type TechnicianFilterRow = {
  user_id: string;
  full_name: string | null;
};

export type SurveyFilterClient = {
  client_id: string;
  client_name: string;
  client_type: 'company' | 'individual';
  is_inactive: boolean;
  logoUrl: string | null;
};

type ClientFilterRow = Omit<SurveyFilterClient, 'logoUrl'>;

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

export const getSurveyFilterOptions = withAuth(async (_user, { tenant }): Promise<SurveyFilterOptions> => {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  const technicianQuery = db.table(`${RESPONSES_TABLE} as sr`);
  db.tenantJoin(technicianQuery, `${TICKETS_TABLE} as t`, 'sr.ticket_id', 't.ticket_id', {
    type: 'left',
    rootTenantColumn: 'sr.tenant',
  });
  db.tenantJoin(technicianQuery, `${USERS_TABLE} as u`, 't.assigned_to', 'u.user_id', {
    type: 'left',
    rootTenantColumn: 't.tenant',
  });

  const clientQuery = db.table(`${RESPONSES_TABLE} as sr`);
  db.tenantJoin(clientQuery, `${CLIENTS_TABLE} as c`, 'sr.client_id', 'c.client_id', {
    type: 'left',
    rootTenantColumn: 'sr.tenant',
  });

  const [templates, technicianRowsRaw, clientRowsRaw] = await Promise.all([
    db.table(TEMPLATES_TABLE)
      .where({ enabled: true })
      .select(['template_id', 'template_name'])
      .orderBy('template_name', 'asc'),
    technicianQuery
      .whereNotNull('t.assigned_to')
      .distinct('t.assigned_to as user_id')
      .select(knex.raw("COALESCE(CONCAT(u.first_name, ' ', u.last_name), '') as full_name"))
      .orderBy('full_name', 'asc'),
    clientQuery
      .whereNotNull('sr.client_id')
      .distinct(
        'sr.client_id as client_id',
        'c.client_name',
        'c.client_type',
        'c.is_inactive'
      )
      .orderBy('c.client_name', 'asc'),
  ]);
  const technicianRows = technicianRowsRaw as unknown as TechnicianFilterRow[];
  const clientRows = clientRowsRaw as unknown as ClientFilterRow[];

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
});
