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

  /** Each test builds its own board and statuses so no test depends on rows another creates or deletes. */
  async function makeBoard(name: string, statusCount = 1): Promise<{ boardId: string; statusIds: string[] }> {
    const boardId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: name, is_default: false });
    const statusIds: string[] = [];
    for (let i = 0; i < statusCount; i++) {
      const statusId = uuidv4();
      statusIds.push(statusId);
      await scoped.table('statuses').insert({
        tenant, status_id: statusId, board_id: boardId, name: `S${i + 1}`, status_type: 'ticket', item_type: 'ticket',
        order_number: i + 1, is_default: i === 0, is_closed: false,
      });
    }
    return { boardId, statusIds };
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
    const { boardId: own, statusIds: [ownStatus] } = await makeBoard('Created own');
    const { boardId: other } = await makeBoard('Created other');
    const onOwn = await addRule({ boardId: own, notifyOnCreate: true, userIds: [alice] });
    await addRule({ boardId: own, notifyOnCreate: true, enabled: false, userIds: [carol] });
    await addRule({ boardId: own, notifyOnCreate: false, statusIds: [ownStatus], userIds: [dave] });
    await addRule({ boardId: other, notifyOnCreate: true, userIds: [dave] });

    const rules = await loadMatchingRules(db, tenant, { kind: 'created', boardId: own });
    expect(rules.map((r) => r.rule_id)).toEqual([onOwn]);
    const recipients = await resolveBoardNotificationRecipients(db, tenant, { kind: 'created', boardId: own });
    expect(recipients.map((r) => r.email)).toEqual(['alice@example.com']);
  });

  it('status trigger matches only rules naming that status; disabled rules are ignored', async () => {
    const { boardId: own, statusIds: [, waiting] } = await makeBoard('Status own', 2);
    const { statusIds: [otherStatus] } = await makeBoard('Status other');
    const statusRule = await addRule({ boardId: own, statusIds: [waiting], userIds: [carol] });
    await addRule({ boardId: own, enabled: false, statusIds: [waiting], userIds: [dave] });

    const matched = await loadMatchingRules(db, tenant, { kind: 'status_entered', statusId: waiting });
    expect(matched.map((r) => r.rule_id)).toEqual([statusRule]);
    const none = await loadMatchingRules(db, tenant, { kind: 'status_entered', statusId: otherStatus });
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
    const { boardId, statusIds: [statusId] } = await makeBoard('FK own');
    await addRule({ boardId, statusIds: [statusId], userIds: [alice] });
    await expect(scoped.table('statuses').where({ status_id: statusId }).delete()).rejects.toThrow();
    expect(await scoped.table('statuses').where({ status_id: statusId }).first()).toBeTruthy();
  });
});
