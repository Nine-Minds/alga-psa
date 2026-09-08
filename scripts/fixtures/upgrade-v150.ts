import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import { createInvoiceTicketSourceFixture } from '../../server/test-utils/invoiceTicketProductionFixtures';
import { buildRecurringServicePeriodPeriodKey, buildRecurringServicePeriodScheduleKey } from '../../shared/billingClients/recurringServicePeriodKeys';

/** Run against v1.5.0 before candidate migrations. Only synthetic rows are created. */
export async function seedUpgradeV150(db: Knex, hashedPassword: string, baselineRoot: string) {
  if (!hashedPassword?.includes(':')) throw new Error('An isolated test account password hash is required');
  const manifest = JSON.parse(readFileSync(path.join(baselineRoot, 'source.json'), 'utf8'));
  if (manifest.commit !== 'f3579f3a317cf51df5f4489e5dcd8f649bb71289') throw new Error('Fixture requires the approved v1.5.0 source');
  const require = createRequire(import.meta.url);
  return db.transaction(async tx => {
    if (await tx('tenants').first()) throw new Error('Upgrade fixture requires an empty tenant database');
    const identities = [];
    for (const label of ['primary', 'secondary']) {
      const tenant = randomUUID(), userId = randomUUID(), clientId = randomUUID();
      const boardId = randomUUID(), statusId = randomUUID(), priorityId = randomUUID(), typeId = randomUUID();
      const email = `upgrade-${label}-${tenant}@example.invalid`;
      await tx('tenants').insert({ tenant, client_name: `Upgrade v1.5.0 ${label}`, email, product_code: 'psa' });
      await tx('users').insert({ tenant, user_id: userId, username: email, email, hashed_password: hashedPassword,
        user_type: 'internal', is_inactive: false, auth_method: 'password' });
      await tx('tenant_settings').insert({ tenant, onboarding_completed: true, onboarding_completed_at: tx.fn.now(), settings: { timezone: 'UTC' } });
      // The nine default roles shipped in v1.5.0 server/seeds/dev/46_roles.cjs.
      for (const [msp, names] of [[true, ['Admin', 'Manager', 'Technician', 'Finance', 'Project Manager', 'Dispatcher']], [false, ['Admin', 'Finance', 'User']]] as const) {
        for (const role_name of names) {
          const role_id = randomUUID();
          await tx('roles').insert({ tenant, role_id, role_name, msp, client: !msp });
          if (msp && role_name === 'Admin') await tx('user_roles').insert({ tenant, user_id: userId, role_id });
        }
      }
      await tx('clients').insert({ tenant, client_id: clientId, client_name: `Upgrade ${label}`, default_currency_code: 'USD' });
      await tx('service_types').insert({ tenant, id: typeId, name: 'Upgrade support' });
      await tx('service_catalog').insert({ tenant, service_id: randomUUID(), service_name: 'Upgrade hourly source',
        billing_method: 'hourly', custom_service_type_id: typeId, default_rate: 15000, unit_of_measure: 'hour' });
      await tx('boards').insert({ tenant, board_id: boardId, board_name: 'Upgrade support' });
      await tx('statuses').insert({ tenant, status_id: statusId, name: 'Open', status_type: 'ticket', order_number: 1 });
      await tx('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Normal', created_by: userId });
      await tx('tickets').insert({ tenant, ticket_id: randomUUID(), ticket_number: 'UPGRADE-1', client_id: clientId,
        title: `Retained ${label} ticket`, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: userId });
      const billing = await createInvoiceTicketSourceFixture(tx, { tenant, userId }, undefined, { materializeServicePeriods: false });
      for (const [lineId, chargeFamily] of [[billing.lineId, 'hourly'], [billing.usageLineId, 'usage']] as const) {
        await tx('recurring_service_periods').insert({ tenant, record_id: randomUUID(),
          schedule_key: buildRecurringServicePeriodScheduleKey({ tenant, obligationType: 'client_contract_line',
            obligationId: lineId, cadenceOwner: 'client', duePosition: 'arrears' }),
          period_key: buildRecurringServicePeriodPeriodKey({ start: '2026-08-01', end: '2026-09-01' }),
          revision: 1, obligation_id: lineId, obligation_type: 'client_contract_line', charge_family: chargeFamily,
          cadence_owner: 'client', due_position: 'arrears', lifecycle_state: 'generated',
          service_period_start: '2026-08-01', service_period_end: '2026-09-01',
          invoice_window_start: '2026-09-01', invoice_window_end: '2026-10-01',
          provenance_kind: 'generated', source_rule_version: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
          reason_code: 'backfill_materialization', source_run_key: `upgrade-v150:${tenant}` });
      }
      identities.push({ label, tenant, userId, email, billing });
    }
    // Use the archived release's permission catalog, never the candidate catalog.
    await require(path.join(baselineRoot, 'server/seeds/dev/47_permissions.cjs')).seed(tx);
    await require(path.join(baselineRoot, 'server/seeds/dev/72_default_billing_settings.cjs')).seed(tx);
    for (const { tenant, userId } of identities) {
      const role = await tx('user_roles').where({ tenant, user_id: userId }).first();
      const permissions = await tx('permissions').where({ tenant, msp: true });
      await tx('role_permissions').insert(permissions.map(p => ({ tenant, role_id: role.role_id, permission_id: p.permission_id })));
    }
    return { baseline: 'v1.5.0', identities };
  });
}
