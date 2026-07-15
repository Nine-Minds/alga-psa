import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import ProjectBillingCapUsage from '@alga-psa/billing/models/projectBillingCapUsage';
import ProjectBillingConfig from '@alga-psa/billing/models/projectBillingConfig';
import ProjectBillingScheduleEntry from '@alga-psa/billing/models/projectBillingScheduleEntry';
import { computeCapWriteDown } from '@alga-psa/billing/services/projectBillingService';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

const HOOK_TIMEOUT = 300_000;

describe('project billing migrated schema', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let projectId: string;
  let cappedProjectId: string;
  let configId: string;
  let cappedConfigId: string;
  let projectStatusId: string;

  const table = (name: string) => tenantDb(db, tenant).table(name);

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenant = uuidv4();
    clientId = uuidv4();
    projectId = uuidv4();
    cappedProjectId = uuidv4();
    configId = uuidv4();
    cappedConfigId = uuidv4();

    await tenantDb(db, tenant)
      .unscoped('tenants', 'project billing integration fixture creates a tenant')
      .insert({
        tenant,
        client_name: `Project Billing ${tenant.slice(0, 8)}`,
        email: `project-billing-${tenant.slice(0, 8)}@example.test`,
      });
    await table('clients').insert({
      tenant,
      client_id: clientId,
      client_name: 'Project Billing Client',
      billing_cycle: 'monthly',
    });
    projectStatusId = uuidv4();
    await table('statuses').insert({
      tenant,
      status_id: projectStatusId,
      name: 'Planned',
      status_type: 'project',
      item_type: 'project',
      order_number: 1,
    });
    await table('projects').insert([
      {
        tenant,
        project_id: projectId,
        client_id: clientId,
        project_name: 'Fixed Project',
        project_number: `PB-${tenant.slice(0, 6)}-1`,
        status: projectStatusId,
        wbs_code: `PB-${tenant.slice(0, 6)}-1`,
      },
      {
        tenant,
        project_id: cappedProjectId,
        client_id: clientId,
        project_name: 'Capped Project',
        project_number: `PB-${tenant.slice(0, 6)}-2`,
        status: projectStatusId,
        wbs_code: `PB-${tenant.slice(0, 6)}-2`,
      },
    ]);
    await table('project_billing_configs').insert([
      {
        tenant,
        config_id: configId,
        project_id: projectId,
        billing_model: 'fixed_price',
        total_price: 10_000,
        currency: 'USD',
        invoice_mode: 'standalone',
      },
      {
        tenant,
        config_id: cappedConfigId,
        project_id: cappedProjectId,
        billing_model: 'time_and_materials',
        total_price: null,
        currency: 'USD',
        invoice_mode: 'standalone',
        cap_amount: 10_000,
        cap_behavior: 'hard_cap',
      },
    ]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('T001: creates all project-billing tables, additive columns, and tenant metadata registrations', async () => {
    for (const tableName of [
      'project_billing_configs',
      'project_billing_schedule_entries',
      'project_phase_rate_overrides',
      'project_billing_cap_usage',
    ]) {
      await expect(db.schema.hasTable(tableName)).resolves.toBe(true);
    }
    await expect(db.schema.hasColumn('project_phases', 'completed_at')).resolves.toBe(true);
    await expect(db.schema.hasColumn('invoices', 'project_id')).resolves.toBe(true);
    await expect(db.schema.hasColumn('project_billing_schedule_entries', 'hold_reason')).resolves.toBe(true);
    await expect(db.schema.hasColumn('project_billing_schedule_entries', 'held_at')).resolves.toBe(true);
    await expect(db.schema.hasColumn('project_billing_schedule_entries', 'held_by')).resolves.toBe(true);
    await expect(db.schema.hasColumn('project_billing_schedule_entries', 'requires_payment_before_work')).resolves.toBe(true);

    const metadata = readFileSync(
      path.resolve(import.meta.dirname, '../../../../../packages/db/src/lib/tenantTableMetadata.ts'),
      'utf8',
    );
    for (const tableName of [
      'project_billing_configs',
      'project_billing_schedule_entries',
      'project_phase_rate_overrides',
      'project_billing_cap_usage',
    ]) {
      expect(metadata).toContain(`${tableName}: { scope: 'tenant' }`);
    }
  });

  it('T001: rejects duplicate config rows and invalid config enum values', async () => {
    await expect(table('project_billing_configs').insert({
      tenant,
      config_id: uuidv4(),
      project_id: projectId,
      billing_model: 'fixed_price',
      total_price: 10_000,
      invoice_mode: 'recurring',
    })).rejects.toMatchObject({ code: '23505' });

    const invalidProjectId = uuidv4();
    await table('projects').insert({
      tenant,
      project_id: invalidProjectId,
      client_id: clientId,
      project_name: 'Invalid Config Project',
      project_number: `PB-${tenant.slice(0, 6)}-3`,
      status: projectStatusId,
      wbs_code: `PB-${tenant.slice(0, 6)}-3`,
    });
    await expect(table('project_billing_configs').insert({
      tenant,
      config_id: uuidv4(),
      project_id: invalidProjectId,
      billing_model: 'retainer',
      invoice_mode: 'recurring',
    })).rejects.toMatchObject({ code: '23514' });
  });

  it('T001/T039: rejects amount XOR violations and invalid status values on real inserts', async () => {
    const base = {
      tenant,
      config_id: configId,
      entry_type: 'milestone',
      description: 'Constraint fixture',
      trigger_type: 'manual',
      display_order: 0,
    };

    await expect(table('project_billing_schedule_entries').insert({
      ...base,
      schedule_entry_id: uuidv4(),
      amount: 1_000,
      percentage: 10,
      status: 'pending',
    })).rejects.toMatchObject({ code: '23514' });
    await expect(table('project_billing_schedule_entries').insert({
      ...base,
      schedule_entry_id: uuidv4(),
      amount: null,
      percentage: null,
      status: 'pending',
    })).rejects.toMatchObject({ code: '23514' });
    await expect(table('project_billing_schedule_entries').insert({
      ...base,
      schedule_entry_id: uuidv4(),
      amount: 1_000,
      percentage: null,
      status: 'paid',
    })).rejects.toMatchObject({ code: '23514' });
  });

  it('T001/T004: model persistence preserves JSONB thresholds and date-only values', async () => {
    await runWithTenant(tenant, async () => {
      const updatedConfig = await ProjectBillingConfig.update(
        cappedConfigId,
        { cap_notify_thresholds: [60, 85, 100] },
        db,
      );
      expect(updatedConfig?.cap_notify_thresholds).toEqual([60, 85, 100]);

      const dateEntry = await ProjectBillingScheduleEntry.insert({
        config_id: configId,
        entry_type: 'milestone',
        description: 'Date-only persistence fixture',
        amount: 1_000,
        percentage: null,
        trigger_type: 'date',
        trigger_date: '2026-11-01',
        status: 'pending',
        display_order: 10,
      }, db);
      expect(dateEntry.trigger_date).toBe('2026-11-01');

      const reloaded = await ProjectBillingScheduleEntry.getById(dateEntry.schedule_entry_id, db);
      expect(reloaded?.trigger_date).toBe('2026-11-01');
    });

    const rawThresholds = await table('project_billing_configs')
      .where({ config_id: cappedConfigId })
      .first('cap_notify_thresholds');
    expect(rawThresholds.cap_notify_thresholds).toEqual([60, 85, 100]);
  });

  it('T039: rejects an illegal pending to invoiced transition at the application lifecycle boundary', async () => {
    const entryId = uuidv4();
    await table('project_billing_schedule_entries').insert({
      tenant,
      schedule_entry_id: entryId,
      config_id: configId,
      entry_type: 'milestone',
      description: 'Transition guard fixture',
      amount: 10_000,
      percentage: null,
      trigger_type: 'manual',
      status: 'pending',
      display_order: 1,
    });

    await runWithTenant(tenant, async () => {
      await expect(ProjectBillingScheduleEntry.transitionStatus(
        entryId,
        'pending',
        'invoiced',
        {},
        db,
      )).rejects.toThrow('Illegal project billing schedule status transition');
    });
  });

  it('T039: persists the ready/held/ready lifecycle and its audit metadata', async () => {
    const entryId = uuidv4();
    const userId = uuidv4();
    await table('users').insert({
      tenant,
      user_id: userId,
      username: `project-billing-${userId.slice(0, 8)}`,
      email: `project-billing-${userId.slice(0, 8)}@example.test`,
      hashed_password: 'not-used',
      user_type: 'internal',
      is_inactive: false,
    });
    await table('project_billing_schedule_entries').insert({
      tenant,
      schedule_entry_id: entryId,
      config_id: configId,
      entry_type: 'milestone',
      description: 'Hold lifecycle fixture',
      amount: 10_000,
      percentage: null,
      trigger_type: 'manual',
      status: 'pending',
      display_order: 2,
    });

    await table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .update({ status: 'ready', ready_at: db.fn.now() });
    await table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .update({
        status: 'held',
        hold_reason: 'Awaiting customer approval',
        held_at: db.fn.now(),
        held_by: userId,
      });

    const held = await table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .first();
    expect(held).toMatchObject({
      status: 'held',
      hold_reason: 'Awaiting customer approval',
      held_by: userId,
    });
    expect(held.held_at).not.toBeNull();
    expect(held.ready_at).not.toBeNull();

    await table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .update({
        status: 'ready',
        hold_reason: null,
        held_at: null,
        held_by: null,
      });
    await expect(table('project_billing_schedule_entries')
      .where({ schedule_entry_id: entryId })
      .first())
      .resolves.toMatchObject({
        status: 'ready',
        hold_reason: null,
        held_at: null,
        held_by: null,
      });
  });

  it('T018: parallel cap consumers serialize on FOR UPDATE and cannot double-spend the cap', async () => {
    await table('project_billing_cap_usage').insert({
      tenant,
      config_id: cappedConfigId,
      billed_amount: 8_500,
      written_down_amount: 0,
      notified_thresholds: JSON.stringify([]),
    });

    const consume = () => db.transaction(async (trx) => {
      const usage = await ProjectBillingCapUsage.getForUpdate(cappedConfigId, trx);
      expect(usage).not.toBeNull();
      const result = computeCapWriteDown(10_000, usage!.billed_amount, 2_000);
      await ProjectBillingCapUsage.increment(
        cappedConfigId,
        { billed: result.billable, writtenDown: result.writtenDown },
        trx,
      );
      return result;
    });

    const results = await runWithTenant(tenant, async () => Promise.all([consume(), consume()]));
    expect(results.map((result) => result.billable).sort((a, b) => a - b)).toEqual([0, 1_500]);
    expect(results.reduce((sum, result) => sum + result.billable, 0)).toBe(1_500);

    const usage = await table('project_billing_cap_usage')
      .where({ config_id: cappedConfigId })
      .first();
    expect(Number(usage.billed_amount)).toBe(10_000);
    expect(Number(usage.written_down_amount)).toBe(2_500);
  });
});
