import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantDb } from '@alga-psa/db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', async () => (await import('./helpers/spMocks')).publishersMock());
vi.mock('@alga-psa/db', async (importOriginal) => (await import('./helpers/spHarness')).mockDbModuleFactory(importOriginal as never));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import { boot, teardown, harness, createHuman, createPrincipal, contextFor, restErrorOf } from './helpers/spHarness';
import { InteractionService } from 'server/src/lib/api/services/InteractionService';
import { TimeSheetService } from 'server/src/lib/api/services/TimeSheetService';

/**
 * T019: interaction create and schedule entry create by a principal.
 * No assignees and no act-as -> ACT_AS_REQUIRED (the principal never self-books).
 * An explicit service assignee is rejected. With act-as the via column is stamped.
 */
let interactionTypeId: string;

beforeAll(async () => {
  await boot('sp_t019_interaction_schedule');
  const type = await tenantDb(harness().db, harness().tenant).table('interaction_types').first('type_id');
  if (!type) throw new Error('no interaction_types in the seeded tenant');
  interactionTypeId = type.type_id;
}, 600_000);
afterAll(teardown);

function interactions() {
  const svc = new InteractionService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  return svc;
}
function scheduling() {
  const svc = new TimeSheetService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  return svc;
}
const interactionInput = (extra: Record<string, unknown> = {}) =>
  ({ type_id: interactionTypeId, client_id: harness().ticket.clientId, title: `T019 ${Math.random()}`, ...extra }) as never;
const slot = () => {
  const start = new Date(Date.UTC(2032, 0, 1 + Math.floor(Math.random() * 300), 9, 0));
  return { start, end: new Date(start.getTime() + 3600_000) };
};
const entryInput = (extra: Record<string, unknown> = {}) => {
  const { start, end } = slot();
  return { title: `T019 entry ${Math.random()}`, scheduled_start: start.toISOString(), scheduled_end: end.toISOString(), work_item_type: 'ad_hoc', ...extra } as never;
};

describe('T019 interaction create', () => {
  it('without assignees and without act-as is ACT_AS_REQUIRED and stores nothing', async () => {
    const { db, tenant } = harness();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal);
    const title = `T019 bare ${Math.random()}`;

    const plain = await interactions().create(interactionInput({ title }), context as never).then(() => null, (e) => e);
    expect(await restErrorOf(plain)).toEqual({ status: 422, code: 'ACT_AS_REQUIRED' });

    const { start } = slot();
    const scheduled = await interactions()
      .create(interactionInput({ title, create_schedule_entry: true, start_time: start.toISOString() }), context as never)
      .then(() => null, (e) => e);
    expect(await restErrorOf(scheduled)).toEqual({ status: 422, code: 'ACT_AS_REQUIRED' });
    expect(await tenantDb(db, tenant).table('interactions').where({ title }).first()).toBeUndefined();
  });

  it('with act-as stamps created_via_principal_id and the human owns it', async () => {
    const { db, tenant } = harness();
    const human = await createHuman();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, human);

    const created = await interactions().create(interactionInput(), context as never);
    const row = await tenantDb(db, tenant).table('interactions').where({ interaction_id: created.interaction_id }).first();
    expect(row.user_id).toBe(human);
    expect(row.created_via_principal_id).toBe(principal.userId);
  });

  it('with act-as, an explicit service assignee on the schedule entry is rejected', async () => {
    const human = await createHuman();
    const principal = await createPrincipal({ allowActAs: true });
    const other = await createPrincipal();
    const context = await contextFor(principal, human);
    const { start } = slot();

    const error = await interactions()
      .create(
        interactionInput({ create_schedule_entry: true, start_time: start.toISOString(), schedule_assigned_user_ids: [other.userId] }),
        context as never,
      )
      .then(() => null, (e) => e);
    const mapped = await restErrorOf(error);
    expect(mapped).not.toBeNull();
    expect([403, 422]).toContain(mapped!.status);
    expect(['HUMAN_WORK_ASSIGNEE_INVALID', 'FORBIDDEN']).toContain(mapped!.code);
  });
});

describe('T019 schedule entry create', () => {
  it('without assignees and without act-as is ACT_AS_REQUIRED (no self-booking)', async () => {
    const { db, tenant } = harness();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal);
    const title = `T019 self-book ${Math.random()}`;

    const error = await scheduling().createScheduleEntry(entryInput({ title }), context as never).then(() => null, (e) => e);
    expect(await restErrorOf(error)).toEqual({ status: 422, code: 'ACT_AS_REQUIRED' });
    expect(await tenantDb(db, tenant).table('schedule_entries').where({ title }).first()).toBeUndefined();
  });

  it('an explicit service assignee is rejected with HUMAN_WORK_ASSIGNEE_INVALID', async () => {
    const principal = await createPrincipal();
    const other = await createPrincipal();
    const context = await contextFor(principal);

    const error = await scheduling().createScheduleEntry(entryInput({ assigned_user_ids: [other.userId] }), context as never).then(() => null, (e) => e);
    expect(await restErrorOf(error)).toEqual({ status: 422, code: 'HUMAN_WORK_ASSIGNEE_INVALID' });
  });

  it('with act-as stamps created_via_principal_id on the entry', async () => {
    const { db, tenant } = harness();
    const human = await createHuman();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, human);

    const entry = await scheduling().createScheduleEntry(entryInput({ assigned_user_ids: [human] }), context as never);
    const row = await tenantDb(db, tenant).table('schedule_entries').where({ entry_id: entry.entry_id }).first();
    expect(row.created_via_principal_id).toBe(principal.userId);
    const assignee = await tenantDb(db, tenant).table('schedule_entry_assignees').where({ entry_id: entry.entry_id }).first();
    expect(assignee.user_id).toBe(human);
  });
});
