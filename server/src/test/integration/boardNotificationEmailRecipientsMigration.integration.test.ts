import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20261013020000_add_board_notification_email_recipients.cjs') as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
  down: (knex: Knex | Knex.Transaction) => Promise<void>;
};

const TABLE = 'board_notification_rule_recipients';

describe('board notification email recipients migration (integration)', () => {
  let knex: Knex;
  let tenant: string;
  let userId: string;
  let ruleId: string;

  beforeAll(async () => {
    knex = await createTestDbConnection({ runSeeds: true });
    tenant = await createTenant(knex, `EmailMig ${uuidv4().slice(0, 6)}`);
    userId = await createUser(knex, tenant, { email: `mig-${uuidv4().slice(0, 6)}@example.com` });
    const boardId = uuidv4();
    ruleId = uuidv4();
    await knex('boards').insert({ tenant, board_id: boardId, board_name: 'Migration board', is_default: false });
    await knex('board_notification_rules').insert({
      tenant, rule_id: ruleId, board_id: boardId, notify_on_create: true, is_enabled: true,
    });
  });

  afterAll(async () => {
    await knex?.destroy();
  });

  const insertRow = (row: Record<string, unknown>) =>
    knex(TABLE).insert({ tenant, rule_id: ruleId, ...row });

  async function expectViolation(row: Record<string, unknown>, constraint?: string) {
    let error: any;
    try {
      await knex.transaction(async (trx) => {
        await trx(TABLE).insert({ tenant, rule_id: ruleId, ...row });
      });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toMatch(/^23/);
    if (constraint) {
      expect(String(error.constraint ?? error.message)).toContain(constraint);
    }
  }

  async function constraintNames(): Promise<string[]> {
    const rows = await knex.raw(
      `SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass`,
      [`public.${TABLE}`]
    );
    return rows.rows.map((r: { conname: string }) => r.conname);
  }

  it('accepts email rows, rejects mixed/malformed rows and duplicates', async () => {
    await insertRow({ recipient_type: 'email', email: 'queue-dl@msp.test' });
    await insertRow({ recipient_type: 'user', user_id: userId });

    await expectViolation({ recipient_type: 'email', email: 'queue-dl@msp.test' }, 'email_uq');
    await expectViolation({ recipient_type: 'email', email: 'x@msp.test', user_id: userId }, 'shape_check');
    await expectViolation({ recipient_type: 'user', user_id: userId, email: 'x@msp.test' }, 'shape_check');
    await expectViolation({ recipient_type: 'email' }, 'shape_check');
    // An unknown type also fails the shape check, and Postgres evaluates CHECK constraints in name
    // order (shape_check < type_check), so assert the violation and the type check's definition.
    await expectViolation({ recipient_type: 'bogus', email: 'x@msp.test' });
    const typeCheck = await knex.raw(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`,
      ['board_notification_rule_recipients_type_check', `public.${TABLE}`]
    );
    expect(typeCheck.rows[0]?.def).toMatch(/'user'.*'team'.*'email'/);
    await expectViolation({ recipient_type: 'email', email: ' Foo@X.com' }, 'email_normalized_check');
    await expectViolation({ recipient_type: 'email', email: 'FOO@x.com' }, 'email_normalized_check');
    await expectViolation({ recipient_type: 'email', email: '@x.com' }, 'email_normalized_check');
  });

  it('is re-runnable and reversible: down removes email rows and schema, up restores it', async () => {
    await migration.up(knex); // re-run on an already-migrated schema
    await migration.up(knex);

    await migration.down(knex);
    expect(await knex.schema.hasColumn(TABLE, 'email')).toBe(false);
    expect(await constraintNames()).not.toContain('board_notification_rule_recipients_email_normalized_check');
    const remaining = await knex(TABLE).where({ tenant, rule_id: ruleId }).select('recipient_type');
    expect(remaining.map((r) => r.recipient_type)).toEqual(['user']);
    // Restored two-branch type check rejects 'email'.
    let error: any;
    try {
      await knex.raw(`INSERT INTO ${TABLE} (tenant, rule_id, recipient_type) VALUES (?, ?, 'email')`, [tenant, ruleId]);
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe('23514');
    await migration.down(knex); // down is re-runnable too

    await migration.up(knex);
    expect(await knex.schema.hasColumn(TABLE, 'email')).toBe(true);
    const names = await constraintNames();
    expect(names).toEqual(expect.arrayContaining([
      'board_notification_rule_recipients_type_check',
      'board_notification_rule_recipients_shape_check',
      'board_notification_rule_recipients_email_normalized_check',
    ]));
    const idx = await knex('pg_indexes')
      .where({ schemaname: 'public', tablename: TABLE, indexname: 'board_notification_rule_recipients_email_uq' })
      .first();
    expect(idx?.indexdef).toContain('UNIQUE INDEX');
    expect(idx?.indexdef).toContain('email IS NOT NULL');
    await insertRow({ recipient_type: 'email', email: 'again@msp.test' });
  });
});
