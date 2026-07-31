import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('project fixup round 2 migrations', () => {
  const productRouting = readRepoFile(
    'server/migrations/20260730003649_add_project_material_billing_destination.cjs',
  );
  const actualHours = readRepoFile(
    'server/migrations/20260730003649_backfill_project_task_actual_hours.cjs',
  );

  it('adds tenant-safe project product routing constraints and indexes', () => {
    expect(productRouting).toContain("billing_destination IN (");
    expect(productRouting).toContain("'project_completion'");
    expect(productRouting).toContain("'on_hold'");
    expect(productRouting).toContain('FOREIGN KEY (tenant, billing_schedule_entry_id)');
    expect(productRouting).toContain('REFERENCES project_billing_schedule_entries (tenant, schedule_entry_id)');
    expect(productRouting).toContain('(tenant, project_id, is_billed, billing_destination, currency_code)');
    expect(productRouting).toContain("update({ billing_destination: 'next_project_invoice' })");
  });

  it('backfills elapsed minutes across all project-task entries with tenant-scoped writes', () => {
    expect(actualHours).toContain("this.on('entry.tenant', '=', 'task.tenant')");
    expect(actualHours).toContain(".andOn('entry.work_item_type', '=', knex.raw('?', ['project_task']))");
    expect(actualHours).toContain('EXTRACT(EPOCH FROM (entry.end_time - entry.start_time))');
    expect(actualHours).not.toContain('billable_duration');
    expect(actualHours).not.toContain('approval_status');
    expect(actualHours).toContain(".where({ tenant: row.tenant, task_id: row.task_id })");
  });
});
