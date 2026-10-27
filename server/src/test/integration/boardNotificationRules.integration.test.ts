import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import {
  loadMatchingRules,
  resolveBoardNotificationAudience,
} from '@alga-psa/shared/lib/tickets/boardNotificationRules';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

type Trigger = Parameters<typeof resolveBoardNotificationAudience>[2];
type Options = Parameters<typeof resolveBoardNotificationAudience>[3];

describe('board notification rules: resolve + expand (integration)', () => {
  const resolveUsers = async (conn: Knex, tenantId: string, trigger: Trigger, options?: Options) =>
    (await resolveBoardNotificationAudience(conn, tenantId, trigger, options)).users;

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
    emails?: string[];
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
    for (const email of opts.emails ?? []) {
      await scoped.table('board_notification_rule_recipients').insert({
        tenant, rule_id: ruleId, recipient_type: 'email', email,
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
    const recipients = await resolveUsers(db, tenant, { kind: 'created', boardId: own });
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

    let recipients = await resolveUsers(db, tenant, { kind: 'created', boardId: boardC });
    expect(recipients.map((r) => r.email).sort()).toEqual(['bob@example.com', 'carol@example.com']);

    // Membership added after the rule was saved takes effect immediately.
    await scoped.table('team_members').insert({ tenant, team_id: teamId, user_id: dave });
    recipients = await resolveUsers(db, tenant, { kind: 'created', boardId: boardC });
    expect(recipients.map((r) => r.email).sort()).toEqual(['bob@example.com', 'carol@example.com', 'dave@example.com']);

    recipients = await resolveUsers(db, tenant, { kind: 'created', boardId: boardC }, {
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
    const recipients = await resolveUsers(db, tenant, { kind: 'created', boardId: boardD });
    expect(recipients.map((r) => r.userId).sort()).toEqual([alice, carol].sort());
  });

  it('blocks deleting a status that a rule references (FK)', async () => {
    const { boardId, statusIds: [statusId] } = await makeBoard('FK own');
    await addRule({ boardId, statusIds: [statusId], userIds: [alice] });
    await expect(scoped.table('statuses').where({ status_id: statusId }).delete()).rejects.toThrow();
    expect(await scoped.table('statuses').where({ status_id: statusId }).first()).toBeTruthy();
  });

  describe('address recipients', () => {
    it('hydrates addresses onto the rule', async () => {
      const { boardId } = await makeBoard('Addr hydrate');
      await addRule({ boardId, notifyOnCreate: true, userIds: [alice], emails: ['queue-dl@msp.test'] });
      const rules = await loadMatchingRules(db, tenant, { kind: 'created', boardId });
      expect(rules[0].email_addresses).toEqual(['queue-dl@msp.test']);
      expect(rules[0].user_ids).toEqual([alice]);
    });

    it('returns an unknown address in addresses, never in users', async () => {
      const { boardId } = await makeBoard('Addr plain');
      await addRule({ boardId, notifyOnCreate: true, emails: ['plain-dl@msp.test'] });
      const audience = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(audience.users).toEqual([]);
      expect(audience.addresses).toEqual([{ email: 'plain-dl@msp.test' }]);
    });

    it('turns an address matching an active internal user into that user and honours excludeUserIds', async () => {
      const { boardId } = await makeBoard('Addr user');
      await addRule({ boardId, notifyOnCreate: true, emails: ['alice@example.com', 'gone@example.com'] });

      const audience = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(audience.users.map((u) => u.userId)).toEqual([alice]);
      // An inactive user is not an active principal, so the address stays a plain address.
      expect(audience.addresses).toEqual([{ email: 'gone@example.com' }]);

      const excluded = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId }, {
        excludeUserIds: [alice],
      });
      expect(excluded.users).toEqual([]);
      // The excluded user must not resurface as a plain address that skips the visibility check.
      expect(excluded.addresses.map((a) => a.email)).toEqual(['gone@example.com']);
    });

    it('dedupes an address-as-user against the same user named directly', async () => {
      const { boardId } = await makeBoard('Addr dedupe user');
      await addRule({ boardId, notifyOnCreate: true, userIds: [alice], emails: ['alice@example.com'] });
      const audience = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(audience.users.map((u) => u.userId)).toEqual([alice]);
      expect(audience.addresses).toEqual([]);
    });

    it('drops an address that matches a contact, an additional contact email or a client location', async () => {
      const { boardId } = await makeBoard('Addr contact');
      const clientId = uuidv4();
      await scoped.table('clients').insert({ tenant, client_id: clientId, client_name: `Addr client ${clientId}` });
      await scoped.table('contacts').insert({
        tenant, contact_name_id: uuidv4(), full_name: 'Cara Contact', email: 'cara@client.test', client_id: clientId,
      });
      const extraContactId = uuidv4();
      await scoped.table('contacts').insert({
        tenant, contact_name_id: extraContactId, full_name: 'Extra Contact', email: 'extra-primary@client.test', client_id: clientId,
      });
      await scoped.table('contact_additional_email_addresses').insert({
        tenant, contact_name_id: extraContactId, email_address: 'extra-alt@client.test', canonical_type: 'work', display_order: 0,
      });
      await scoped.table('client_locations').insert({
        tenant, location_id: uuidv4(), client_id: clientId, location_name: 'HQ', address_line1: '1 Way', city: 'X',
        country_code: 'US', country_name: 'United States', email: 'hq@client.test',
      });
      await addRule({
        boardId, notifyOnCreate: true,
        emails: ['cara@client.test', 'extra-alt@client.test', 'hq@client.test', 'kept-dl@msp.test'],
      });
      const audience = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(audience.users).toEqual([]);
      expect(audience.addresses).toEqual([{ email: 'kept-dl@msp.test' }]);
    });

    it('drops a saved address whose domain is mapped to a client after the rule was saved', async () => {
      const { boardId } = await makeBoard('Addr late domain');
      const clientId = uuidv4();
      await scoped.table('clients').insert({ tenant, client_id: clientId, client_name: `Late domain client ${clientId}` });
      await addRule({ boardId, notifyOnCreate: true, emails: ['dl@late-domain.test', 'kept-dl@msp.test'] });
      const before = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(before.addresses.map((a) => a.email).sort()).toEqual(['dl@late-domain.test', 'kept-dl@msp.test']);

      await scoped.table('client_inbound_email_domains').insert({ tenant, client_id: clientId, domain: 'Late-Domain.test' });
      const after = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(after.addresses).toEqual([{ email: 'kept-dl@msp.test' }]);
    });

    it('drops a saved address that later becomes a connected inbound mailbox', async () => {
      const { boardId } = await makeBoard('Addr late mailbox');
      await addRule({ boardId, notifyOnCreate: true, emails: ['inbox@late-mailbox.test', 'kept-dl@msp.test'] });
      await scoped.table('email_providers').insert({
        id: uuidv4(), tenant, provider_type: 'google', provider_name: 'Late box', mailbox: 'Inbox@late-mailbox.test',
        is_active: true, status: 'connected',
      });
      const audience = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(audience.addresses).toEqual([{ email: 'kept-dl@msp.test' }]);
    });

    it('dedupes addresses across rules and ignores addresses on a disabled rule', async () => {
      const { boardId } = await makeBoard('Addr dedupe');
      await addRule({ boardId, notifyOnCreate: true, emails: ['shared-dl@msp.test', 'a-dl@msp.test'] });
      await addRule({ boardId, notifyOnCreate: true, emails: ['shared-dl@msp.test'] });
      await addRule({ boardId, notifyOnCreate: true, enabled: false, emails: ['disabled-dl@msp.test'] });
      const audience = await resolveBoardNotificationAudience(db, tenant, { kind: 'created', boardId });
      expect(audience.addresses.map((a) => a.email).sort()).toEqual(['a-dl@msp.test', 'shared-dl@msp.test']);
    });

    it('resolves addresses for the status-entered trigger too', async () => {
      const { boardId, statusIds: [, waiting] } = await makeBoard('Addr status', 2);
      await addRule({ boardId, statusIds: [waiting], emails: ['status-dl@msp.test'] });
      const audience = await resolveBoardNotificationAudience(db, tenant, { kind: 'status_entered', statusId: waiting });
      expect(audience.addresses).toEqual([{ email: 'status-dl@msp.test' }]);
    });
  });
});
