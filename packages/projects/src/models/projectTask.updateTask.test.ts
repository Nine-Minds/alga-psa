/**
 * Clearing a task description has to reach the database: the editor sends
 * `description: null, description_rich_text: null` for an emptied body, and
 * dropping those nulls left the old description on screen after a "successful"
 * save. Fields that must never be nulled stay string-only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const updatePayloads = vi.hoisted(() => [] as Record<string, any>[]);

/** Chainable stub for `.where(...).update(payload).returning('*')`. */
function stubTable(): any {
  const builder: any = {
    where: () => builder,
    update: (payload: Record<string, any>) => {
      updatePayloads.push(payload);
      return builder;
    },
    returning: async () => [{ task_id: 'task-1', ...updatePayloads[updatePayloads.length - 1] }],
  };
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => stubTable() }),
}));

vi.mock('@alga-psa/shared/billingClients/ticketProjectAttribution', () => ({
  billableTicketProjectsQuery: vi.fn(),
}));

vi.mock('./project', () => ({ default: {} }));

import ProjectTaskModel from './projectTask';

const knexStub: any = { fn: { now: () => 'now()' } };

/** Run updateTask and hand back the payload it would have written. */
async function capturePayload(taskData: Record<string, any>): Promise<Record<string, any>> {
  await ProjectTaskModel.updateTask(knexStub, 'tenant-1', 'task-1', taskData as any);
  return updatePayloads[updatePayloads.length - 1];
}

describe('ProjectTaskModel.updateTask description nulls', () => {
  beforeEach(() => {
    updatePayloads.length = 0;
  });

  it('writes nulls for both description columns so clearing sticks', async () => {
    const payload = await capturePayload({ description: null, description_rich_text: null });

    expect(payload).toHaveProperty('description', null);
    expect(payload).toHaveProperty('description_rich_text', null);
  });

  it('still writes description strings through unchanged', async () => {
    const payload = await capturePayload({
      description: 'Replace the NIC',
      description_rich_text: '[{"type":"paragraph"}]',
    });

    expect(payload.description).toBe('Replace the NIC');
    expect(payload.description_rich_text).toBe('[{"type":"paragraph"}]');
  });

  it('clears only the column the caller sent', async () => {
    const payload = await capturePayload({ description_rich_text: null });

    expect(payload).toHaveProperty('description_rich_text', null);
    expect(payload).not.toHaveProperty('description');
  });

  it('refuses to null the fields a task cannot live without', async () => {
    const payload = await capturePayload({
      task_name: null,
      wbs_code: null,
      project_status_mapping_id: null,
      order_key: null,
      task_type_key: null,
    });

    for (const column of [
      'task_name',
      'wbs_code',
      'project_status_mapping_id',
      'order_key',
      'task_type_key',
    ]) {
      expect(payload, `column: ${column}`).not.toHaveProperty(column);
    }
  });
});
