import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import {
  loadMatchingRules,
  resolveBoardNotificationRecipients,
} from '@alga-psa/shared/lib/tickets/boardNotificationRules';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

describe('board notification rules: resolve + expand (integration)', () => {
  let db: Knex;
  let tenant: string;
  let boardA: string;
  let boardB: string;
  let statusA1: string;
  let statusA2: string;
  let statusB1: string;
  let alice: string;
  let bob: string;
  let carol: string;
  let dave: string;
  let inactive: string;
  let teamId: string;
  let scoped: ReturnType<typeof tenantDb>;

  async function addRule(opts: {
    boardId: string;
    notifyOnCreate?: boolean;
    enabled?: boolean;
    statusIds?: string[];
    userIds?: string[];
    teamIds?: string[];
  }): Promise<string> {
    const ruleId = uuidv4();
    await scoped.table('board_notification_rules').insert({
      tenant,
      rule_id: ruleId,
      board_id: opts.boardId,
      notify_on_create: opts.notifyOnCreate ?? false,
      is_enabled: opts.enabled ?? true,
    });
    for (const statusId of opts.statusIds ?? []) {
      await scoped.table('board_notification_rule_statuses').insert({ tenant, rule_id: ruleId, status_id: statusId });
    }
    for (const userId of opts.userIds ?? []) {
      await scoped.table('board_notification_rule_recipients').insert({
        tenant, rule_id: ruleId, recipient_type: 'user', user_id: userId,
      });
    }
    for (const team of opts.teamIds ?? []) {
      await scoped.table('board_notification_rule_recipients').insert({
        tenant, rule_id: ruleId, recipient_type: 'team', team_id: team,
      });
    }
    return ruleId;
  }

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = await createTenant(db, `Rules ${uuidv4().slice(0, 6)}`);
    scoped = tenantDb(db, tenant);
    alice = await createUser(db, tenant, { email: 'alice@example.com' });
    bob = await createUser(db, tenant, { email: 'bob@example.com' });
    carol = await createUser(db, tenant, { email: 'carol@example.com' });
    dave = await createUser(db, tenant, { email: 'dave@example.com' });
    inactive = await createUser(db, tenant, { email: 'gone@example.com', is_inactive: true });

    boardA = uuidv4();
    boardB = uuidv4();
    statusA1 = uuidv4();
    statusA2 = uuidv4();
    statusB1 = uuidv4();
    await scoped.table('boards').insert([
      { tenant, board_id: boardA, board_name: 'A', is_default: true },
      { tenant, board_id: boardB, board_name: 'B', is_default: false },
    ]);
    await scoped.table('statuses').insert([
      { tenant, status_id: statusA1, board_id: boardA, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
      { tenant, status_id: statusA2, board_id: boardA, name: 'Waiting', status_type: 'ticket', item_type: 'ticket', order_number: 2, is_default: false, is_closed: false },
      { tenant, status_id: statusB1, board_id: boardB, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
    ]);
    teamId = uuidv4();
    await scoped.table('teams').insert({ tenant, team_id: teamId, team_name: 'Techs', manager_id: alice });
    await scoped.table('team_members').insert([
      { tenant, team_id: teamId, user_id: bob },
      { tenant, team_id: teamId, user_id: inactive },
    ]);
  }, 900_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('created trigger matches only its board and only enabled rules with notify_on_create', async () => {
    const onA = await addRule({ boardId: boardA, notifyOnCreate: true, userIds: [alice] });
    await addRule({ boardId: boardA, notifyOnCreate: true, enabled: false, userIds: [carol] });
    await addRule({ boardId: boardA, notifyOnCreate: false, statusIds: [statusA1], userIds: [dave] });
    await addRule({ boardId: boardB, notifyOnCreate: true, userIds: [dave] });

    const rulesA = await loadMatchingRules(db, tenant, { kind: 'created', boardId: boardA });
    expect(rulesA.map((r) => r.rule_id)).toEqual([onA]);
    const recipients = await resolveBoardNotificationRecipients(db, tenant, { kind: 'created', boardId: boardA });
    expect(recipients.map((r) => r.email)).toEqual(['alice@example.com']);
  });

  it('status trigger matches only rules naming that status; disabled rules are ignored', async () => {
    const statusRule = await addRule({ boardId: boardA, statusIds: [statusA2], userIds: [carol] });
    await addRule({ boardId: boardA, enabled: false, statusIds: [statusA2], userIds: [dave] });

    const matched = await loadMatchingRules(db, tenant, { kind: 'status_entered', statusId: statusA2 });
    expect(matched.map((r) => r.rule_id)).toEqual([statusRule]);
    const none = await loadMatchingRules(db, tenant, { kind: 'status_entered', statusId: statusB1 });
    expect(none).toEqual([]);
  });

  it('expands teams at send time, drops inactive members, dedupes direct+team, honours exclusions', async () => {
    const boardC = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardC, board_name: 'C', is_default: false });
    await addRule({ boardId: boardC, notifyOnCreate: true, userIds: [bob, carol], teamIds: [teamId] });

    let recipients = await resolveBoardNotificationRecipients(db, tenant, { kind: 'created', boardId: boardC });
    expect(recipients.map((r) => r.email).sort()).toEqual(['bob@example.com', 'carol@example.com']);

    // Membership added after the rule was saved takes effect immediately.
    await scoped.table('team_members').insert({ tenant, team_id: teamId, user_id: dave });
    recipients = await resolveBoardNotificationRecipients(db, tenant, { kind: 'created', boardId: boardC });
    expect(recipients.map((r) => r.email).sort()).toEqual(['bob@example.com', 'carol@example.com', 'dave@example.com']);

    recipients = await resolveBoardNotificationRecipients(db, tenant, { kind: 'created', boardId: boardC }, {
      excludeUserIds: [bob, null, undefined],
    });
    expect(recipients.map((r) => r.email).sort()).toEqual(['carol@example.com', 'dave@example.com']);
    await scoped.table('team_members').where({ team_id: teamId, user_id: dave }).delete();
  });

  it('dedupes a user across several matching rules', async () => {
    const boardD = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardD, board_name: 'D', is_default: false });
    await addRule({ boardId: boardD, notifyOnCreate: true, userIds: [alice] });
    await addRule({ boardId: boardD, notifyOnCreate: true, userIds: [alice, carol] });
    const recipients = await resolveBoardNotificationRecipients(db, tenant, { kind: 'created', boardId: boardD });
    expect(recipients.map((r) => r.userId).sort()).toEqual([alice, carol].sort());
  });

  it('blocks deleting a status that a rule references (FK)', async () => {
    await expect(scoped.table('statuses').where({ status_id: statusA2 }).delete()).rejects.toThrow();
  });
});
