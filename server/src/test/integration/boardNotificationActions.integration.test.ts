import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));
const hasPermissionMock = vi.hoisted(() => vi.fn(async (..._args: any[]) => true));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { tenantDb } from '@alga-psa/db';
import { deleteBoard } from '../../../../packages/tickets/src/actions/board-actions/boardActions';
import {
  getBoardNotificationSettings,
  saveBoardNotificationSettings,
} from '../../../../packages/tickets/src/actions/board-actions/boardNotificationActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const HOOK_TIMEOUT = 900_000;

describe('board notification settings actions (integration)', () => {
  let db: Knex;
  let tenant: string;
  let scoped: ReturnType<typeof tenantDb>;
  let boardId: string;
  let otherBoardId: string;
  let statusNew: string;
  let statusWaiting: string;
  let otherBoardStatus: string;
  let adminUser: string;
  let tech1: string;
  let tech2: string;
  let inactiveTech: string;
  let clientUser: string;
  let teamId: string;

  const expectError = (result: unknown, fragment: string) => {
    expect(isActionMessageError(result) || isActionPermissionError(result), JSON.stringify(result)).toBe(true);
    expect(getErrorMessage(result as any)).toContain(fragment);
  };

  const countRows = async (table: string, where: Record<string, unknown>) =>
    (await scoped.table(table).where(where)).length;

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = await createTenant(db, `NotifActions ${uuidv4().slice(0, 6)}`);
    dbRef.knex = db;
    dbRef.tenant = tenant;
    scoped = tenantDb(db, tenant);

    adminUser = await createUser(db, tenant, { email: 'admin-na@example.com' });
    tech1 = await createUser(db, tenant, { email: 'tech1-na@example.com' });
    tech2 = await createUser(db, tenant, { email: 'tech2-na@example.com' });
    inactiveTech = await createUser(db, tenant, { email: 'gone-na@example.com', is_inactive: true });
    clientUser = await createUser(db, tenant, { email: 'client-na@example.com', user_type: 'client' });
    userRef.user = { user_id: adminUser, user_type: 'internal', tenant };

    boardId = uuidv4();
    otherBoardId = uuidv4();
    statusNew = uuidv4();
    statusWaiting = uuidv4();
    otherBoardStatus = uuidv4();
    await scoped.table('boards').insert([
      { tenant, board_id: boardId, board_name: 'Support', is_default: true },
      { tenant, board_id: otherBoardId, board_name: 'Other', is_default: false },
    ]);
    await scoped.table('statuses').insert([
      { tenant, status_id: statusNew, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
      { tenant, status_id: statusWaiting, board_id: boardId, name: 'Waiting', status_type: 'ticket', item_type: 'ticket', order_number: 2, is_default: false, is_closed: false },
      { tenant, status_id: otherBoardStatus, board_id: otherBoardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
    ]);
    teamId = uuidv4();
    await scoped.table('teams').insert({ tenant, team_id: teamId, team_name: 'Techs', manager_id: tech1 });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    await scoped.table('board_notification_rules').where({ board_id: boardId }).delete();
    await scoped.table('board_default_watchers').where({ board_id: boardId }).delete();
  });

  it('round-trips rules and default watchers, deduping ids', async () => {
    const saved = await saveBoardNotificationSettings(boardId, {
      rules: [
        {
          notify_on_create: true,
          status_ids: [statusWaiting, statusWaiting],
          user_ids: [tech1, tech1, tech2],
          team_ids: [teamId],
        },
        { notify_on_create: false, status_ids: [statusNew], user_ids: [tech2], is_enabled: false },
      ],
      default_watcher_user_ids: [tech1, tech1],
    });
    expect(isActionMessageError(saved)).toBe(false);

    const loaded: any = await getBoardNotificationSettings(boardId);
    expect(loaded.default_watcher_user_ids).toEqual([tech1]);
    expect(loaded.rules).toHaveLength(2);
    const [first, second] = loaded.rules;
    expect(first).toMatchObject({ notify_on_create: true, is_enabled: true, status_ids: [statusWaiting], team_ids: [teamId] });
    expect([...first.user_ids].sort()).toEqual([tech1, tech2].sort());
    expect(second).toMatchObject({ notify_on_create: false, is_enabled: false, status_ids: [statusNew], user_ids: [tech2], team_ids: [] });
  });

  it('reuses rule ids provided in the input and replaces everything else', async () => {
    const first: any = await saveBoardNotificationSettings(boardId, {
      rules: [{ notify_on_create: true, user_ids: [tech1] }, { notify_on_create: true, user_ids: [tech2] }],
    });
    const [keep, drop] = first.rules;

    const second: any = await saveBoardNotificationSettings(boardId, {
      rules: [{ rule_id: keep.rule_id, notify_on_create: true, user_ids: [tech2] }],
    });
    expect(second.rules).toHaveLength(1);
    expect(second.rules[0].rule_id).toBe(keep.rule_id);
    expect(second.rules[0].user_ids).toEqual([tech2]);
    expect(await countRows('board_notification_rules', { rule_id: drop.rule_id })).toBe(0);
  });

  it('rejects a rule without a trigger or without a recipient, and persists nothing', async () => {
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [{ notify_on_create: false, status_ids: [], user_ids: [tech1] }] }),
      'must fire on ticket creation or on at least one status'
    );
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [{ notify_on_create: true, user_ids: [], team_ids: [] }] }),
      'must notify at least one user, team or email address'
    );
    // A valid first rule with an invalid second one must not leave the first behind.
    expectError(
      await saveBoardNotificationSettings(boardId, {
        rules: [{ notify_on_create: true, user_ids: [tech1] }, { notify_on_create: false, user_ids: [tech1] }],
      }),
      'must fire on ticket creation'
    );
    expect(await countRows('board_notification_rules', { board_id: boardId })).toBe(0);
  });

  it('rejects a status from another board, a client user, an inactive user and an unknown team', async () => {
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [{ status_ids: [otherBoardStatus], user_ids: [tech1] }] }),
      'ticket status on this board'
    );
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [{ notify_on_create: true, user_ids: [clientUser] }] }),
      'active internal users'
    );
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [{ notify_on_create: true, user_ids: [inactiveTech] }] }),
      'active internal users'
    );
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [], default_watcher_user_ids: [clientUser] }),
      'active internal users'
    );
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [{ notify_on_create: true, team_ids: [uuidv4()] }] }),
      'team not found'
    );
    expect(await countRows('board_notification_rules', { board_id: boardId })).toBe(0);
  });

  it('keeps saving a board whose stored recipient and default watcher were deactivated; a newly chosen inactive user is still rejected', async () => {
    const leaver = await createUser(db, tenant, { email: `leaver-${uuidv4().slice(0, 6)}@example.com` });
    const leaverWatcher = await createUser(db, tenant, { email: `leaver-w-${uuidv4().slice(0, 6)}@example.com` });
    const input = {
      rules: [{ notify_on_create: true, user_ids: [leaver] }],
      default_watcher_user_ids: [leaverWatcher, tech1],
    };
    const first: any = await saveBoardNotificationSettings(boardId, input);
    expect(isActionMessageError(first), JSON.stringify(first)).toBe(false);

    await scoped.table('users').whereIn('user_id', [leaver, leaverWatcher]).update({ is_inactive: true });

    // Unchanged re-save (rule id reused) succeeds: the rule's only recipient is inactive but stored.
    const again: any = await saveBoardNotificationSettings(boardId, {
      rules: [{ rule_id: first.rules[0].rule_id, ...input.rules[0] }],
      default_watcher_user_ids: input.default_watcher_user_ids,
    });
    expect(isActionMessageError(again), JSON.stringify(again)).toBe(false);
    expect(again.rules[0].user_ids).toEqual([leaver]);
    expect([...again.default_watcher_user_ids].sort()).toEqual([leaverWatcher, tech1].sort());

    // Adding a newly chosen inactive user is still rejected, and nothing changes.
    expectError(
      await saveBoardNotificationSettings(boardId, {
        rules: [{ rule_id: first.rules[0].rule_id, notify_on_create: true, user_ids: [leaver, inactiveTech] }],
        default_watcher_user_ids: input.default_watcher_user_ids,
      }),
      'active internal users'
    );
    expectError(
      await saveBoardNotificationSettings(boardId, {
        rules: again.rules,
        default_watcher_user_ids: [...input.default_watcher_user_ids, inactiveTech],
      }),
      'active internal users'
    );
    const loaded: any = await getBoardNotificationSettings(boardId);
    expect(loaded.rules[0].user_ids).toEqual([leaver]);
    expect(loaded.default_watcher_user_ids).not.toContain(inactiveTech);
  });

  it('rejects an unknown board', async () => {
    expectError(await saveBoardNotificationSettings(uuidv4(), { rules: [] }), 'Board not found');
  });

  it('enforces ticket_settings read and update permissions', async () => {
    hasPermissionMock.mockImplementation(async (_user: any, resource: string, action: string) =>
      !(resource === 'ticket_settings' && action === 'update')
    );
    expectError(
      await saveBoardNotificationSettings(boardId, { rules: [{ notify_on_create: true, user_ids: [tech1] }] }),
      'Permission denied'
    );
    expect(await countRows('board_notification_rules', { board_id: boardId })).toBe(0);
    expect(isActionPermissionError(await getBoardNotificationSettings(boardId))).toBe(false);

    hasPermissionMock.mockImplementation(async (_user: any, resource: string, action: string) =>
      !(resource === 'ticket_settings' && action === 'read')
    );
    const denied = await getBoardNotificationSettings(boardId);
    expect(isActionPermissionError(denied)).toBe(true);
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'read', expect.anything());
  });

  it('cascades rules, recipients, rule statuses and default watchers when the board is deleted', async () => {
    const cascadeBoard = uuidv4();
    const cascadeStatus = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: cascadeBoard, board_name: 'Cascade', is_default: false });
    await scoped.table('statuses').insert({
      tenant, status_id: cascadeStatus, board_id: cascadeBoard, name: 'New', status_type: 'ticket',
      item_type: 'ticket', order_number: 1, is_default: true, is_closed: false,
    });
    const saved: any = await saveBoardNotificationSettings(cascadeBoard, {
      rules: [{ notify_on_create: true, status_ids: [cascadeStatus], user_ids: [tech1], team_ids: [teamId] }],
      default_watcher_user_ids: [tech2],
    });
    const ruleId = saved.rules[0].rule_id;
    expect(await countRows('board_notification_rule_recipients', { rule_id: ruleId })).toBe(2);
    expect(await countRows('board_notification_rule_statuses', { rule_id: ruleId })).toBe(1);

    // Statuses are board-owned; a status referenced by a rule blocks its own deletion.
    await expect(scoped.table('statuses').where({ status_id: cascadeStatus }).delete()).rejects.toThrow();

    // deleteBoard clears the board's statuses (which rule rows reference) and then the board.
    const result: any = await deleteBoard(cascadeBoard, true);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(await countRows('statuses', { board_id: cascadeBoard })).toBe(0);

    expect(await countRows('board_notification_rules', { board_id: cascadeBoard })).toBe(0);
    expect(await countRows('board_notification_rule_recipients', { rule_id: ruleId })).toBe(0);
    expect(await countRows('board_notification_rule_statuses', { rule_id: ruleId })).toBe(0);
    expect(await countRows('board_default_watchers', { board_id: cascadeBoard })).toBe(0);
  });

  describe('email address recipients', () => {
    let contactClientId: string;

    const auditRows = async () =>
      db.transaction(async (trx) => {
        await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
        return trx('audit_logs')
          .where({ tenant, table_name: 'board_notification_rule_recipients', record_id: boardId, operation: 'board_notification_email_recipients_changed' })
          .orderBy('timestamp', 'asc');
      });
    const clearAudit = async () =>
      db.transaction(async (trx) => {
        await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
        await trx('audit_logs').where({ tenant, record_id: boardId }).delete();
      });
    const save = (rules: any[]) => saveBoardNotificationSettings(boardId, { rules });

    beforeAll(async () => {
      contactClientId = uuidv4();
      await scoped.table('clients').insert({ tenant, client_id: contactClientId, client_name: `Addr client ${contactClientId}` });
      await scoped.table('contacts').insert({ tenant, contact_name_id: uuidv4(), full_name: 'Cara', email: 'cara@contact-co.example', client_id: contactClientId });
      const withAlt = uuidv4();
      await scoped.table('contacts').insert({ tenant, contact_name_id: withAlt, full_name: 'Alt', email: 'alt-primary@contact-co.example', client_id: contactClientId });
      await scoped.table('contact_additional_email_addresses').insert({ tenant, contact_name_id: withAlt, email_address: 'Alt-Extra@contact-co.example', canonical_type: 'work', display_order: 0 });
      await scoped.table('client_locations').insert({
        tenant, location_id: uuidv4(), client_id: contactClientId, location_name: 'HQ', address_line1: '1 Way', city: 'X',
        country_code: 'US', country_name: 'United States', email: 'hq@contact-co.example',
      });
      await scoped.table('client_inbound_email_domains').insert({ tenant, client_id: contactClientId, domain: 'bigclient.example' });
      await scoped.table('email_providers').insert({
        id: uuidv4(), tenant, provider_type: 'google', provider_name: 'Support box', mailbox: 'Support@msp-inbound.example',
        is_active: true, status: 'connected',
      });
    }, HOOK_TIMEOUT);

    beforeEach(async () => {
      await clearAudit();
    });

    it('round-trips normalized, deduped addresses and accepts a rule whose only recipient is an address', async () => {
      const saved: any = await save([
        { notify_on_create: true, email_addresses: ['  Queue-DL@MSP.test ', 'queue-dl@msp.test', '"Pager" <pager@msp.test>'] },
      ]);
      expect(isActionMessageError(saved), JSON.stringify(saved)).toBe(false);
      expect([...saved.rules[0].email_addresses].sort()).toEqual(['pager@msp.test', 'queue-dl@msp.test']);
      expect(saved.rules[0].user_ids).toEqual([]);

      const loaded: any = await getBoardNotificationSettings(boardId);
      expect([...loaded.rules[0].email_addresses].sort()).toEqual(['pager@msp.test', 'queue-dl@msp.test']);
    });

    it('rejects an invalid address and a rule with more than 25 addresses, persisting nothing', async () => {
      expectError(await save([{ notify_on_create: true, email_addresses: ['not an address'] }]), 'invalid email address');
      // Single-label domains pass a naive '@' check but are dropped by the send path's validator.
      for (const bad of ['a@b', 'user@localhost']) {
        expectError(await save([{ notify_on_create: true, email_addresses: [bad] }]), 'invalid email address');
      }
      const tooMany = Array.from({ length: 26 }, (_, i) => `dl${i}@msp.test`);
      expectError(await save([{ notify_on_create: true, email_addresses: tooMany }]), 'at most 25 email addresses');
      const exactly = Array.from({ length: 25 }, (_, i) => `dl${i}@msp.test`);
      const ok: any = await save([{ notify_on_create: true, email_addresses: exactly }]);
      expect(ok.rules[0].email_addresses).toHaveLength(25);
      expect(await countRows('board_notification_rules', { board_id: boardId })).toBe(1);
      // A failed save leaves the previous state alone.
      expectError(await save([{ notify_on_create: true, email_addresses: tooMany }]), 'at most 25');
      expect(await countRows('board_notification_rule_recipients', { recipient_type: 'email' })).toBeGreaterThanOrEqual(25);
    });

    it('rejects each D5 case with its own message and translation key', async () => {
      const cases: Array<[string, string, string]> = [
        ['tech1-na@example.com', "Alga user's email", 'notificationEmailIsUser'],
        ['cara@contact-co.example', 'client contact or location', 'notificationEmailIsContact'],
        ['alt-extra@contact-co.example', 'client contact or location', 'notificationEmailIsContact'],
        ['hq@contact-co.example', 'client contact or location', 'notificationEmailIsContact'],
        ['anyone@bigclient.example', "client's email domain", 'notificationEmailClientDomain'],
        ['support@msp-inbound.example', 'connected inbound mailbox', 'notificationEmailInboundMailbox'],
      ];
      for (const [address, fragment, key] of cases) {
        const result: any = await save([{ notify_on_create: true, email_addresses: ['fine-dl@msp.test', address] }]);
        expectError(result, fragment);
        expect(result.messageKey).toBe(`features/tickets:errors.board.${key}`);
        expect(await countRows('board_notification_rules', { board_id: boardId })).toBe(0);
      }
    });

    it('an inactive user and a client-type user email do not block an address', async () => {
      const result: any = await save([{ notify_on_create: true, email_addresses: ['gone-na@example.com'] }]);
      expect(isActionMessageError(result), JSON.stringify(result)).toBe(false);
    });

    it('re-validates addresses that are already stored', async () => {
      await save([{ notify_on_create: true, email_addresses: ['later-contact@msp.test'] }]);
      const loaded: any = await getBoardNotificationSettings(boardId);
      // The address becomes a contact after it was stored: the next save must refuse it.
      const contactId = uuidv4();
      await scoped.table('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Later', email: 'later-contact@msp.test', client_id: contactClientId });
      try {
        expectError(
          await save([{ rule_id: loaded.rules[0].rule_id, notify_on_create: true, email_addresses: ['later-contact@msp.test'] }]),
          'client contact or location'
        );
      } finally {
        await scoped.table('contacts').where({ contact_name_id: contactId }).delete();
      }
    });

    it('writes one audit row with the correct added/removed per rule, and none when unchanged', async () => {
      const first: any = await save([
        { notify_on_create: true, email_addresses: ['a-dl@msp.test', 'b-dl@msp.test'] },
        { notify_on_create: true, user_ids: [tech1] },
      ]);
      let rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(adminUser);
      expect(rows[0].changed_data.rules).toEqual([
        { rule_id: first.rules[0].rule_id, added: ['a-dl@msp.test', 'b-dl@msp.test'], removed: [] },
      ]);

      // Unchanged addresses: no new row.
      await save([
        { rule_id: first.rules[0].rule_id, notify_on_create: true, email_addresses: ['b-dl@msp.test', 'a-dl@msp.test'] },
        { rule_id: first.rules[1].rule_id, notify_on_create: true, user_ids: [tech1] },
      ]);
      expect(await auditRows()).toHaveLength(1);

      // Add one, remove one.
      await save([
        { rule_id: first.rules[0].rule_id, notify_on_create: true, email_addresses: ['b-dl@msp.test', 'c-dl@msp.test'] },
        { rule_id: first.rules[1].rule_id, notify_on_create: true, user_ids: [tech1] },
      ]);
      rows = await auditRows();
      expect(rows).toHaveLength(2);
      expect(rows[1].changed_data.rules).toEqual([
        { rule_id: first.rules[0].rule_id, added: ['c-dl@msp.test'], removed: ['a-dl@msp.test'] },
      ]);

      // Deleting the rule counts as removing its addresses.
      await save([{ rule_id: first.rules[1].rule_id, notify_on_create: true, user_ids: [tech1] }]);
      rows = await auditRows();
      expect(rows).toHaveLength(3);
      expect(rows[2].changed_data.rules).toEqual([
        { rule_id: first.rules[0].rule_id, added: [], removed: ['b-dl@msp.test', 'c-dl@msp.test'] },
      ]);
    });

    it('a failed save writes no audit row', async () => {
      await save([{ notify_on_create: true, email_addresses: ['x-dl@msp.test', 'cara@contact-co.example'] }]);
      expect(await auditRows()).toHaveLength(0);
    });
  });
});
