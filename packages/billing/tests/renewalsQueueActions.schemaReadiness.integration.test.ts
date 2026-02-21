import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions strict-schema integration wiring', () => {
  it('T249: listRenewalQueueRows executes against migrated schema and avoids missing-column query branches', () => {
    expect(source).toContain('const REQUIRED_RENEWAL_SCHEMA_COLUMNS = {');
    expect(source).toContain('const assertRenewalSchemaReady = async (knex: any): Promise<void> => {');
    expect(source).toContain('await assertRenewalSchemaReady(knex);');
    expect(source).toContain("throw new Error('Permission denied: Cannot read renewals queue');");
    expect(source).toContain('export const listRenewalQueueRows = withAuth(async (');
    expect(source).toContain(".where({ 'cc.tenant': tenant, 'cc.is_active': true })");
    expect(source).toContain("Run the latest server database migrations, then retry this renewals operation.");
  });

  it('T250: snoozeRenewalQueueItem persists status/snoozed_until plus last_action audit metadata', () => {
    expect(source).toContain('export const snoozeRenewalQueueItem = withAuth(async (');
    expect(source).toContain('await assertRenewalSchemaReady(knex);');
    expect(source).toContain("status: 'snoozed',");
    expect(source).toContain('snoozed_until: normalizedSnoozedUntil,');
    expect(source).toContain('withActionLabel({');
    expect(source).toContain("}, 'snooze'), actorUserId");
    expect(source).toContain('withActionTimestamp(');
    expect(source).toContain('withActionNote(');
    expect(source).toContain('withActionActor(');
    expect(source).toContain("throw new Error('Snooze target date must be in the future');");
  });

  it('T251: markRenewalQueueItemRenewing transitions pending->renewing and persists actor/timestamp metadata', () => {
    expect(source).toContain('export const markRenewalQueueItemRenewing = withAuth(async (');
    expect(source).toContain('await assertRenewalSchemaReady(knex);');
    expect(source).toContain("if (previousStatus !== 'pending') {");
    expect(source).toContain("status: 'renewing',");
    expect(source).toContain("}, 'mark_renewing'), actorUserId");
    expect(source).toContain('withActionTimestamp(');
    expect(source).toContain('withActionActor(');
    expect(source).toContain('previous_status: previousStatus,');
    expect(source).toContain("status: 'renewing',");
  });
});
