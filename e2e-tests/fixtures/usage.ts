import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';
import { buildRecurringServicePeriodPeriodKey, buildRecurringServicePeriodScheduleKey } from '../../shared/billingClients/recurringServicePeriodKeys';
import {
  assignContractLineToClient, createBucketOverlayForPlan, createFixedPlanAssignment,
  createTestService, setupClientTaxConfiguration, type BillingFixtureContext,
} from '../../server/test-utils/billingTestHelpers';

/** Contract configuration is setup; the browser must create the usage and preview it. */
export async function createUsageFixture(db: Knex, sourceEmail: string) {
  return db.transaction(async (trx) => {
    const actors = await createProductionBrowserActors(trx, { sourceEmail });
    const tenant = actors.primary;
    const scope = { tenant: tenant.tenantId };
    const client = tenant.clients.primary;
    const financeRole = await trx('roles').where({ ...scope, role_name: 'Finance', msp: true, client: false }).first();
    if (!financeRole) throw new Error('Usage fixture requires the canonical MSP Finance role');
    const source = await trx('users').where({ ...scope, user_id: tenant.admin.userId }).first('hashed_password');
    const operator = { userId: randomUUID(), email: `finance-${actors.runId}@example.invalid`, role: 'msp:Finance' };
    await trx('users').insert({ ...scope, user_id: operator.userId, email: operator.email, username: operator.email,
      first_name: 'Browser', last_name: 'Finance', user_type: 'internal', auth_method: 'password',
      hashed_password: source.hashed_password, is_inactive: false, two_factor_enabled: false,
      is_google_user: false, needs_contact_association: false,
    });
    await trx('user_roles').insert({ ...scope, user_id: operator.userId, role_id: financeRole.role_id });
    // Use the last complete UTC month so the due-work UI can find the period
    // on future CI runs. The returned boundaries are retained for replay.
    const now = new Date();
    const month = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
    const period = { start: month(-1), end: month(0), billingEnd: month(1) };
    const profileId = randomUUID();
    await trx('client_billing_profiles').insert({ ...scope, billing_profile_id: profileId,
      client_id: client.id, name: client.name, is_default: true, is_system_managed_default: true, is_active: true,
    });
    const context: BillingFixtureContext = {
      db: trx, tenantId: tenant.tenantId, clientId: client.id,
      async createEntity(table, data, idField = 'id') {
        const row: Record<string, unknown> = { ...data, ...scope };
        if (!(idField in row)) row[idField] = randomUUID();
        await trx(table).insert(row);
        return row[idField] as string;
      },
    };
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', regionName: 'Browser zero-tax region',
      taxPercentage: 0, startDate: period.start });
    const service = { id: await createTestService(context, {
      service_name: `Browser usage ${actors.runId}`, billing_method: 'usage', default_rate: 1000,
      unit_of_measure: 'unit', tax_region: 'US-NY',
    }), name: `Browser usage ${actors.runId}`, rateCents: 1000 };
    const usageLine = { id: randomUUID(), name: `Usage line ${actors.runId}`, configId: randomUUID() };
    await trx('contract_lines').insert({ ...scope, contract_line_id: usageLine.id,
      contract_line_name: usageLine.name, billing_frequency: 'monthly', is_custom: false,
      contract_line_type: 'Usage', billing_timing: 'arrears', cadence_owner: 'client',
    });
    await trx('contract_line_service_configuration').insert({ ...scope, config_id: usageLine.configId,
      contract_line_id: usageLine.id, service_id: service.id, configuration_type: 'Usage', quantity: null,
    });
    await trx('contract_line_services').insert({ ...scope, contract_line_id: usageLine.id, service_id: service.id });
    const billingCycleId = randomUUID();
    await trx('client_billing_cycles').insert({ ...scope, billing_cycle_id: billingCycleId,
      billing_profile_id: profileId, client_id: client.id, billing_cycle: 'monthly',
      effective_date: period.end, period_start_date: period.end, period_end_date: period.billingEnd,
    });
    const assignment = await assignContractLineToClient(context, usageLine.id, {
      startDate: period.start, materializeServicePeriods: false,
    });
    const bucketName = `Bucket line ${actors.runId}`;
    const bucket = await createFixedPlanAssignment(context, service.id, {
      contractId: assignment.contractId, clientContractId: assignment.clientContractId,
      planName: bucketName, baseRateCents: 0, detailBaseRateCents: 0, quantity: 1,
      billingFrequency: 'monthly', billingTiming: 'arrears', startDate: period.start,
      materializeServicePeriods: false,
    });
    await createBucketOverlayForPlan(context, bucket.contractLineId, {
      serviceId: service.id, totalHours: 40, overageRateCents: 7500,
      allowRollover: false, billingPeriod: 'monthly',
    });
    // Already scheduled periods are explicit setup. Keep this standalone
    // browser fixture independent of server-action imports and lifecycle mocks.
    // Exercise usage creation and pricing through the application itself.
    for (const [lineId, family] of [[usageLine.id, 'usage'], [bucket.contractLineId, 'fixed']]) {
      for (const offset of [-1, 0]) {
        const start = month(offset), end = month(offset + 1);
        await trx('recurring_service_periods').insert({ ...scope, record_id: randomUUID(),
          schedule_key: buildRecurringServicePeriodScheduleKey({ tenant: tenant.tenantId,
            obligationType: 'client_contract_line', obligationId: lineId, cadenceOwner: 'client', duePosition: 'arrears' }),
          period_key: buildRecurringServicePeriodPeriodKey({ start, end }), revision: 1,
          obligation_id: lineId, obligation_type: 'client_contract_line', charge_family: family,
          cadence_owner: 'client', due_position: 'arrears', lifecycle_state: 'generated',
          service_period_start: `${start}T00:00:00Z`, service_period_end: `${end}T00:00:00Z`,
          invoice_window_start: `${end}T00:00:00Z`, invoice_window_end: `${month(offset + 2)}T00:00:00Z`,
          provenance_kind: 'generated', source_rule_version: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
          reason_code: 'backfill_materialization', source_run_key: `browser-fixture:${actors.runId}`,
        });
      }
    }
    return { actors, tenant, operator, client, service, usageLine, period, billingCycleId,
      bucketLine: { id: bucket.contractLineId, name: bucketName },
      quantity: 4, expectedAmountCents: 4000,
    };
  });
}
