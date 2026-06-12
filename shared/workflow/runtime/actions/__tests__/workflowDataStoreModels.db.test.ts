import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';

import WorkflowDataStoreModel from '../../../persistence/workflowDataStoreModel';
import WorkflowEntityLinkModel from '../../../persistence/workflowEntityLinkModel';
import { createTenant, createTestDbConnection } from './_dbTestUtils';

describe('workflow data-store persistence models', () => {
  let db: Knex;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantA = await createTenant(db, 'Workflow Store Tenant A');
    tenantB = await createTenant(db, 'Workflow Store Tenant B');
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db('workflow_entity_links').del();
    await db('workflow_data_store').del();
  });

  it('T003: KV get/set round-trip bumps revisions and compare-and-set detects conflicts', async () => {
    const created = await WorkflowDataStoreModel.set(db, tenantA, {
      namespace: 'sync-cursor',
      key: 'source-a',
      value: { cursor: 'one' },
      value_type: 'json',
    });

    expect(created.created).toBe(true);
    expect(created.conflict).toBe(false);
    expect(created.record?.revision).toBe(1);

    const found = await WorkflowDataStoreModel.get(db, tenantA, 'sync-cursor', 'source-a');
    expect(found?.value).toEqual({ cursor: 'one' });

    const updated = await WorkflowDataStoreModel.set(db, tenantA, {
      namespace: 'sync-cursor',
      key: 'source-a',
      value: { cursor: 'two' },
      if_revision: 1,
    });
    expect(updated.created).toBe(false);
    expect(updated.conflict).toBe(false);
    expect(updated.record?.revision).toBe(2);

    const conflict = await WorkflowDataStoreModel.set(db, tenantA, {
      namespace: 'sync-cursor',
      key: 'source-a',
      value: { cursor: 'stale' },
      if_revision: 1,
    });
    expect(conflict).toMatchObject({ record: null, created: false, conflict: true });
  });

  it('T004: store.increment initializes from initial and remains atomic under concurrent increments', async () => {
    const first = await WorkflowDataStoreModel.increment(db, tenantA, {
      namespace: 'counters',
      key: 'welcome-emails',
      initial: 10,
      by: 5,
    });
    expect(first.created).toBe(true);
    expect(Number(first.record.value)).toBe(15);
    expect(first.record.revision).toBe(1);

    await Promise.all(Array.from({ length: 12 }, () =>
      WorkflowDataStoreModel.increment(db, tenantA, {
        namespace: 'counters',
        key: 'welcome-emails',
        by: 1,
      })
    ));

    const record = await WorkflowDataStoreModel.get(db, tenantA, 'counters', 'welcome-emails');
    expect(Number(record?.value)).toBe(27);
    expect(record?.revision).toBe(13);
  });

  it('T005: expired rows are not returned and deleteExpired removes them', async () => {
    await WorkflowDataStoreModel.set(db, tenantA, {
      namespace: 'ttl',
      key: 'expired',
      value: true,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await WorkflowDataStoreModel.set(db, tenantA, {
      namespace: 'ttl',
      key: 'active',
      value: true,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(WorkflowDataStoreModel.get(db, tenantA, 'ttl', 'expired')).resolves.toBeNull();
    await expect(WorkflowDataStoreModel.get(db, tenantA, 'ttl', 'active')).resolves.toMatchObject({ key: 'active' });

    await WorkflowDataStoreModel.set(db, tenantA, {
      namespace: 'ttl',
      key: 'sweep-me',
      value: true,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(WorkflowDataStoreModel.deleteExpired(db, tenantA)).resolves.toBe(1);
    await expect(WorkflowDataStoreModel.get(db, tenantA, 'ttl', 'sweep-me')).resolves.toBeNull();
  });

  it('T006/T007: links upsert idempotently by typed edge and lookup honors direction and filters', async () => {
    const first = await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'project-task-mirror',
      left: { type: 'project_task', id: 'task-a' },
      right: { type: 'project_task', id: 'task-b' },
      relation: 'mirrors',
      attributes: { fieldMap: { title: 'task_name' } },
    });
    const duplicate = await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'project-task-mirror',
      left: { type: 'project_task', id: 'task-a' },
      right: { type: 'project_task', id: 'task-b' },
      relation: 'mirrors',
      attributes: { updated: true },
    });
    const secondRelation = await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'project-task-mirror',
      left: { type: 'project_task', id: 'task-a' },
      right: { type: 'project_task', id: 'task-b' },
      relation: 'blocks',
    });
    await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'project-task-mirror',
      left: { type: 'project_task', id: 'task-a' },
      right: { type: 'ticket', id: 'ticket-1' },
      relation: 'mirrors',
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.record.link_id).toBe(first.record.link_id);
    expect(duplicate.record.attributes).toEqual({ updated: true });
    expect(secondRelation.created).toBe(true);
    expect(secondRelation.record.link_id).not.toBe(first.record.link_id);

    await expect(WorkflowEntityLinkModel.lookup(db, tenantA, {
      namespace: 'project-task-mirror',
      from: { type: 'project_task', id: 'task-a' },
      direction: 'forward',
      relation: 'mirrors',
      right_type: 'project_task',
    })).resolves.toMatchObject({
      matches: [{ id: 'task-b', type: 'project_task', relation: 'mirrors', attributes: { updated: true } }],
    });

    await expect(WorkflowEntityLinkModel.lookup(db, tenantA, {
      namespace: 'project-task-mirror',
      from: { type: 'project_task', id: 'task-b' },
      direction: 'reverse',
      relation: 'mirrors',
    })).resolves.toMatchObject({
      matches: [{ id: 'task-a', type: 'project_task', relation: 'mirrors' }],
    });

    const either = await WorkflowEntityLinkModel.lookup(db, tenantA, {
      namespace: 'project-task-mirror',
      from: { type: 'project_task', id: 'task-a' },
      direction: 'either',
      limit: 10,
    });
    expect(either.matches.map((match) => `${match.relation}:${match.type}:${match.id}`).sort()).toEqual([
      'blocks:project_task:task-b',
      'mirrors:project_task:task-b',
      'mirrors:ticket:ticket-1',
    ]);
  });

  it('T008: links.delete supports partial criteria and requires at least one side', async () => {
    await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'mirror',
      left: { type: 'project_task', id: 'a' },
      right: { type: 'project_task', id: 'b' },
      relation: 'mirrors',
    });
    await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'mirror',
      left: { type: 'project_task', id: 'a' },
      right: { type: 'project_task', id: 'c' },
      relation: 'mirrors',
    });
    await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'mirror',
      left: { type: 'project_task', id: 'x' },
      right: { type: 'project_task', id: 'b' },
      relation: 'blocks',
    });

    await expect(WorkflowEntityLinkModel.delete(db, tenantA, {
      namespace: 'mirror',
    })).rejects.toThrow('WORKFLOW_ENTITY_LINK_DELETE_REQUIRES_LEFT_OR_RIGHT');

    await expect(WorkflowEntityLinkModel.delete(db, tenantA, {
      namespace: 'mirror',
      left: { type: 'project_task', id: 'a' },
      relation: 'mirrors',
    })).resolves.toBe(2);

    await expect(WorkflowEntityLinkModel.delete(db, tenantA, {
      namespace: 'mirror',
      right: { type: 'project_task', id: 'b' },
    })).resolves.toBe(1);
  });

  it('T009: KV and link models isolate rows by tenant', async () => {
    await WorkflowDataStoreModel.set(db, tenantA, {
      namespace: 'shared-name',
      key: 'cursor',
      value: 'tenant-a',
    });
    await WorkflowDataStoreModel.set(db, tenantB, {
      namespace: 'shared-name',
      key: 'cursor',
      value: 'tenant-b',
    });
    await WorkflowEntityLinkModel.upsert(db, tenantA, {
      namespace: 'shared-links',
      left: { type: 'project_task', id: 'same' },
      right: { type: 'project_task', id: 'tenant-a-target' },
    });
    await WorkflowEntityLinkModel.upsert(db, tenantB, {
      namespace: 'shared-links',
      left: { type: 'project_task', id: 'same' },
      right: { type: 'project_task', id: 'tenant-b-target' },
    });

    await expect(WorkflowDataStoreModel.get(db, tenantA, 'shared-name', 'cursor')).resolves.toMatchObject({ value: 'tenant-a' });
    await expect(WorkflowDataStoreModel.get(db, tenantB, 'shared-name', 'cursor')).resolves.toMatchObject({ value: 'tenant-b' });

    const tenantALinks = await WorkflowEntityLinkModel.lookup(db, tenantA, {
      namespace: 'shared-links',
      from: { type: 'project_task', id: 'same' },
    });
    const tenantBLinks = await WorkflowEntityLinkModel.lookup(db, tenantB, {
      namespace: 'shared-links',
      from: { type: 'project_task', id: 'same' },
    });

    expect(tenantALinks.matches.map((match) => match.id)).toEqual(['tenant-a-target']);
    expect(tenantBLinks.matches.map((match) => match.id)).toEqual(['tenant-b-target']);
  });
});
