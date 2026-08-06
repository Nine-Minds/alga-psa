import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(process.cwd(), 'migrations', '20260805130000_repair_renewal_clock_payload.cjs'));

const RENEWAL_KEY = 'system.opportunity.renewal-suggestions';

const colKey = (col: string): string => String(col).split('.').pop() as string;

class Q {
  rows: Record<string, unknown>[];
  private predicates: Array<(row: Record<string, unknown>) => boolean>;

  constructor(rows: Record<string, unknown>[]) {
    this.rows = rows;
    this.predicates = [];
  }

  private match(row: Record<string, unknown>): boolean {
    return this.predicates.every((p) => p(row));
  }

  where(colOrObj: string | Record<string, unknown>, value?: unknown): this {
    if (typeof colOrObj === 'string') {
      const col = colKey(colOrObj);
      this.predicates.push((row) => row[col] === value);
    } else {
      for (const [k, v] of Object.entries(colOrObj)) {
        const col = colKey(k);
        this.predicates.push((row) => row[col] === v);
      }
    }
    return this;
  }

  select(): this {
    return this;
  }

  first(): Record<string, unknown> | undefined {
    return this.rows.find((row) => this.match(row));
  }

  update(data: Record<string, unknown>): number {
    const targets = this.rows.filter((row) => this.match(row));
    for (const row of targets) {
      Object.assign(row, { ...data, updated_at: new Date().toISOString() });
    }
    return targets.length;
  }

  then(resolve: (value: Record<string, unknown>[]) => void): void {
    resolve(this.rows);
  }
}

function buildKnex(tables: Record<string, Record<string, unknown>[]>) {
  return (name: string) => new Q(tables[name] ?? []);
}

function buildHarness() {
  const tenants = [{ tenant: 'tenant-a' }, { tenant: 'tenant-b' }];
  const workflowDefinitions = [
    { workflow_id: 'renewal-workflow', key: RENEWAL_KEY, tenant: 'tenant-a' },
    { workflow_id: 'unrelated-workflow', key: 'custom.other', tenant: 'tenant-b' }
  ];
  const schedule = (workflowId: string, name: string, tenant: string, overrides: Record<string, unknown> = {}) => ({
    id: `${workflowId}-schedule`,
    tenant,
    workflow_id: workflowId,
    workflow_version: 1,
    name,
    trigger_type: 'recurring',
    cron: '0 6 * * *',
    timezone: 'UTC',
    payload_json: null,
    last_error: 'Workflow payload failed validation',
    last_run_status: 'error',
    ...overrides
  });
  const tenantWorkflowSchedule = [
    schedule('renewal-workflow', RENEWAL_KEY, 'tenant-a'),
    schedule('unrelated-workflow', 'Custom reminder', 'tenant-b', { cron: '0 9 * * 1-5' })
  ];
  return { knex: buildKnex({ tenants, workflow_definitions: workflowDefinitions, tenant_workflow_schedule: tenantWorkflowSchedule }), tenantWorkflowSchedule };
}

describe('repair renewal clock payload migration', () => {
  it('repairs the seeded renewal payload, clears failure residue, leaves unrelated schedules untouched', async () => {
    const { knex, tenantWorkflowSchedule } = buildHarness();

    await migration.up(knex);

    const renewal = tenantWorkflowSchedule.find((row) => row.id === 'renewal-workflow-schedule')!;
    expect(renewal.payload_json).not.toBeNull();
    expect(renewal.payload_json).toMatchObject({
      triggerType: 'recurring',
      scheduleId: 'renewal-workflow-schedule',
      workflowId: 'renewal-workflow',
      workflowVersion: 1,
      timezone: 'UTC',
      cron: '0 6 * * *'
    });
    expect((renewal.payload_json as Record<string, unknown>).scheduleName).toBeUndefined();
    expect(renewal.last_error).toBeNull();
    expect(renewal.last_run_status).toBeNull();

    const unrelated = tenantWorkflowSchedule.find((row) => row.id === 'unrelated-workflow-schedule')!;
    expect(unrelated.payload_json).toBeNull();
    expect(unrelated.last_error).toBe('Workflow payload failed validation');
    expect(unrelated.cron).toBe('0 9 * * 1-5');
  });

  it('is idempotent across re-runs', async () => {
    const { knex, tenantWorkflowSchedule } = buildHarness();

    await migration.up(knex);
    const first = tenantWorkflowSchedule.find((row) => row.id === 'renewal-workflow-schedule')!.payload_json;
    await migration.up(knex);
    const second = tenantWorkflowSchedule.find((row) => row.id === 'renewal-workflow-schedule')!.payload_json;

    expect(first).toMatchObject(second as Record<string, unknown>);
    expect((first as Record<string, unknown>).scheduleName).toBeUndefined();
  });
});