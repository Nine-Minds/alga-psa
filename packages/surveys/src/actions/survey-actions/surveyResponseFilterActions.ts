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

export type SurveyFilterOptions = {
  templates: FilterOption[];
  technicians: FilterOption[];
};

const TEMPLATES_TABLE = 'survey_templates';
const RESPONSES_TABLE = 'survey_responses';
const TICKETS_TABLE = 'tickets';
const USERS_TABLE = 'users';

export const getSurveyFilterOptions = withAuth(async (_user, { tenant }): Promise<SurveyFilterOptions> => {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  const technicianQuery = db.table(`${RESPONSES_TABLE} as sr`);
  db.tenantJoin(technicianQuery, `${TICKETS_TABLE} as t`, 'sr.ticket_id', 't.ticket_id', {
    type: 'left',
    rootTenantColumn: 'sr.tenant',
  });
  db.tenantJoin(technicianQuery, 'projects as p', 'sr.project_id', 'p.project_id', {
    type: 'left', rootTenantColumn: 'sr.tenant',
  });
  db.tenantJoin(technicianQuery, `${USERS_TABLE} as u`, 'sr.tenant', 'u.tenant', {
      on: join => { join.andOn(function () {
        this.on('t.assigned_to', '=', 'u.user_id').orOn('p.assigned_to', '=', 'u.user_id');
      }); },
    type: 'left',
    rootTenantColumn: 'sr.tenant',
  });

  const [templates, technicianRowsRaw] = await Promise.all([
    db.table(TEMPLATES_TABLE)
      .where({ enabled: true })
      .select(['template_id', 'template_name'])
      .orderBy('template_name', 'asc'),
    technicianQuery
      .whereNotNull('u.user_id')
      .distinct('u.user_id as user_id')
      .select(knex.raw("COALESCE(CONCAT(u.first_name, ' ', u.last_name), '') as full_name"))
      .orderBy('full_name', 'asc'),
  ]);
  const technicianRows = technicianRowsRaw as unknown as TechnicianFilterRow[];

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
  };
});
