import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createRecurringBillingFixture } from './recurring-billing';

export async function createTimeBillingFixture(db: Knex, sourceEmail: string) {
  return db.transaction(async trx => {
    const billing = await createRecurringBillingFixture(trx, sourceEmail, 'hourly');
    const { tenant, client, period, actors } = billing;
    const scope = { tenant: tenant.tenantId };
    await trx('default_billing_settings').insert({ ...scope,
      zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: true });
    await trx('clients').where({ ...scope, client_id: client.id })
      .update({ billing_email: tenant.portal.email, payment_terms: 'net_30' });
    const teamId = randomUUID();
    await trx('teams').insert({ ...scope, team_id: teamId,
      team_name: `Billing approval ${actors.runId}`, manager_id: tenant.admin.userId });
    await trx('team_members').insert({ ...scope, team_id: teamId, user_id: tenant.technician.userId });
    const sheet = { id: randomUUID(), periodId: randomUUID() };
    const end = new Date(`${period.start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    await trx('time_periods').insert({ ...scope, period_id: sheet.periodId,
      start_date: period.start, end_date: end.toISOString().slice(0, 10), is_closed: false });
    await trx('time_sheets').insert({ ...scope, id: sheet.id, period_id: sheet.periodId,
      user_id: tenant.technician.userId, approval_status: 'DRAFT' });
    const ticket = { id: randomUUID(), title: `Billable ticket ${actors.runId}`, number: `TIME-${actors.runId.slice(0, 8)}` };
    await trx('tickets').insert({ ...scope, ticket_id: ticket.id, title: ticket.title,
      ticket_number: ticket.number, client_id: client.id, contact_name_id: tenant.portal.contactId,
      board_id: tenant.ticketing.boardId, status_id: tenant.ticketing.openStatusId,
      priority_id: tenant.ticketing.priorityId, entered_by: tenant.admin.userId,
      assigned_to: tenant.technician.userId, entered_at: `${period.start}T08:00:00Z`, is_closed: false });
    return { ...billing, sheet, ticket };
  });
}
