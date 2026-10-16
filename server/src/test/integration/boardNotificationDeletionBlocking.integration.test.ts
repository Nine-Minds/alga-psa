import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { deleteEntityWithValidation, getDeletionConfig } from '@alga-psa/core/server';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const HOOK_TIMEOUT = 180_000;

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'board_notification_rule_recipients').del();
  await tenantTable(tenantId, 'board_notification_rule_statuses').del();
  await tenantTable(tenantId, 'board_notification_rules').del();
  await tenantTable(tenantId, 'teams').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createFixture() {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const boardId = uuidv4();
  const teamId = uuidv4();
  const statusId = uuidv4();
  const ruleId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Support',
    display_order: 10,
    is_default: true,
    is_inactive: false,
  });
  await tenantTable(tenantId, 'teams').insert({
    tenant: tenantId,
    team_id: teamId,
    team_name: 'Service Desk',
    manager_id: userId,
  });
  await tenantTable(tenantId, 'statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    name: 'Escalated',
    status_type: 'ticket',
    order_number: 10,
    created_by: userId,
    board_id: boardId,
  });
  await tenantTable(tenantId, 'board_notification_rules').insert({
    tenant: tenantId,
    rule_id: ruleId,
    board_id: boardId,
    notify_on_create: false,
    is_enabled: true,
  });

  return { tenantId, userId, boardId, teamId, statusId, ruleId };
}

async function deleteViaValidation(entityType: 'team' | 'status', entityId: string, tenantId: string) {
  return deleteEntityWithValidation(entityType, entityId, db, tenantId, async (trx, tenant) => {
    await tenantDb(trx, tenant)
      .table(entityType === 'team' ? 'teams' : 'statuses')
      .where(entityType === 'team' ? { team_id: entityId } : { status_id: entityId })
      .del();
  });
}

describe('board notification rule deletion blocking', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('is configured for both entity types', () => {
    expect(getDeletionConfig('team')?.dependencies.find((d) => d.type === 'board_notification_recipient'))
      .toMatchObject({ table: 'board_notification_rule_recipients', foreignKey: 'team_id', label: 'board notification rule' });
    expect(getDeletionConfig('status')?.dependencies.find((d) => d.type === 'board_notification_status'))
      .toMatchObject({ table: 'board_notification_rule_statuses', foreignKey: 'status_id', label: 'board notification rule' });
  });

  it('blocks deleting a team that is a rule recipient, then allows it once the rule is removed', async () => {
    const { tenantId, teamId, ruleId } = await createFixture();
    await tenantTable(tenantId, 'board_notification_rule_recipients').insert({
      tenant: tenantId,
      rule_id: ruleId,
      recipient_type: 'team',
      team_id: teamId,
    });

    const blocked = await deleteViaValidation('team', teamId, tenantId);
    expect(blocked.canDelete).toBe(false);
    expect((blocked as any).deleted).toBeUndefined();
    expect(blocked.code).toBe('DEPENDENCIES_EXIST');
    expect(blocked.dependencies).toEqual([
      expect.objectContaining({ type: 'board_notification_recipient', count: 1, label: 'board notification rule' }),
    ]);
    expect(blocked.message).toContain('board notification rule');
    expect(await tenantTable(tenantId, 'teams').where({ team_id: teamId }).first()).toBeTruthy();

    await tenantTable(tenantId, 'board_notification_rule_recipients').where({ rule_id: ruleId }).del();
    await tenantTable(tenantId, 'board_notification_rules').where({ rule_id: ruleId }).del();

    const allowed = await deleteViaValidation('team', teamId, tenantId);
    expect(allowed).toMatchObject({ canDelete: true, deleted: true });
    expect(await tenantTable(tenantId, 'teams').where({ team_id: teamId }).first()).toBeFalsy();
  });

  it('blocks deleting a status that triggers a rule, then allows it once the rule is removed', async () => {
    const { tenantId, statusId, ruleId } = await createFixture();
    await tenantTable(tenantId, 'board_notification_rule_statuses').insert({
      tenant: tenantId,
      rule_id: ruleId,
      status_id: statusId,
    });

    const blocked = await deleteViaValidation('status', statusId, tenantId);
    expect(blocked.canDelete).toBe(false);
    expect(blocked.code).toBe('DEPENDENCIES_EXIST');
    expect(blocked.dependencies).toEqual([
      expect.objectContaining({ type: 'board_notification_status', count: 1, label: 'board notification rule' }),
    ]);
    expect(blocked.message).toContain('board notification rule');
    expect(await tenantTable(tenantId, 'statuses').where({ status_id: statusId }).first()).toBeTruthy();

    // Deleting the rule cascades its status rows.
    await tenantTable(tenantId, 'board_notification_rules').where({ rule_id: ruleId }).del();

    const allowed = await deleteViaValidation('status', statusId, tenantId);
    expect(allowed).toMatchObject({ canDelete: true, deleted: true });
    expect(await tenantTable(tenantId, 'statuses').where({ status_id: statusId }).first()).toBeFalsy();
  });

  it('does not block a team or status that no rule references', async () => {
    const { tenantId, teamId, statusId } = await createFixture();
    expect(await deleteViaValidation('team', teamId, tenantId)).toMatchObject({ canDelete: true, deleted: true });
    expect(await deleteViaValidation('status', statusId, tenantId)).toMatchObject({ canDelete: true, deleted: true });
  });
});
