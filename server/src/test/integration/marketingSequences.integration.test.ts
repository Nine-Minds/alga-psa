/**
 * T005/T006/T007 — sequence send loop, suppression guard, unsubscribe.
 *
 * T005: enroll a contact in a 2-step active sequence; the due-step job sends
 * step 1 via TenantEmailService, advances the enrollment, records a
 * 'Marketing: Email Sent' interaction linked to the step, and schedules the
 * next send from step 2's delay; after the final step the enrollment
 * completes.
 *
 * T006: a suppressed address receives zero sends — the enrollment is stopped
 * and TenantEmailService is never invoked.
 *
 * T007: unsubscribeEnrollmentInternal immediately suppresses (reason
 * 'unsubscribe', source 'link'), stops every active enrollment for that
 * address (by contact AND by email join), and the suppression survives
 * contact deletion + re-import.
 *
 * TenantEmailService is replaced at the module boundary (@alga-psa/email)
 * with a capture-double: getInstance() returns an object whose initialize()
 * is a no-op and whose sendEmail() records its params. The real service is
 * never constructed, so no SMTP/provider config is needed.
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant, createUser, createClient } from '../../../test-utils/testDataFactory';

import {
  createSequenceInternal,
  updateSequenceInternal,
  enrollContactInternal,
  sendDueSequenceStepsInternal,
  unsubscribeEnrollmentInternal,
} from '../../../../packages/marketing/src/lib/sequences';
import { addSuppression, isSuppressed } from '../../../../packages/marketing/src/lib/suppression';
import { verifyTrackingDestination } from '../../../../packages/marketing/src/lib/signing';

const describeDb = await describeWithDb();
const requireCjs = createRequire(import.meta.url);

const BASE_URL = 'https://test.example.com';
const SIGNING_SECRET = 'integration-test-signing-secret';

// Capture-double for the outbound email abstraction (see header).
const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getInstance: vi.fn(() => ({
      initialize: vi.fn(async () => undefined),
      sendEmail: sendEmailMock,
    })),
  },
}));

let db: Knex;
let tenantId: string;
let userId: string;
let clientId: string;

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function createContactWithEmail(fullName: string, email: string): Promise<string> {
  const contactId = uuidv4();
  await tenantTable('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: fullName,
    email,
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return contactId;
}

async function createActiveSequence(
  name: string,
  steps: Array<{ step_order: number; delay_minutes: number; subject: string; body_template?: string }>,
) {
  const sequence = await createSequenceInternal(db, tenantId, {
    name,
    status: 'active',
    steps: steps.map((step) => ({ body_template: 'body', ...step })),
  }, userId);
  const stepRows = await tenantTable('marketing_sequence_steps')
    .where({ tenant: tenantId, sequence_id: sequence.sequence_id })
    .orderBy('step_order', 'asc');
  return { sequence, steps: stepRows };
}

async function getEnrollment(enrollmentId: string) {
  return tenantTable('marketing_sequence_enrollments')
    .where({ tenant: tenantId, enrollment_id: enrollmentId })
    .first();
}

async function marketingInteractionCount(typeName: string, contactId: string): Promise<number> {
  const rows = await tenantTable('interactions as i')
    .join('system_interaction_types as it', 'it.type_id', '=', 'i.type_id')
    .where({ 'i.tenant': tenantId, 'it.type_name': typeName, 'i.contact_name_id': contactId })
    .count('* as count');
  return Number((rows[0] as { count: string | number }).count);
}

describeDb('T005-T007: marketing sequences', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Marketing Sequences Tenant');
    userId = await createUser(db, tenantId, { username: 'marketing.sequences.test' });
    clientId = await createClient(db, tenantId, 'Sequence Client');

    const seedTypes = requireCjs('../../../migrations/20260719103000_seed_marketing_interaction_types.cjs');
    await seedTypes.up(db);
  }, 120_000);

  beforeEach(() => {
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({ success: true });
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('T005: sends due steps in order, advances the enrollment, links the email_sent interaction, and completes', async () => {
    const contactId = await createContactWithEmail('Ada Lovelace', 'ada@example.com');
    const { sequence, steps } = await createActiveSequence('Welcome drip', [
      { step_order: 1, delay_minutes: 0, subject: 'Welcome {{contact.first_name}}', body_template: 'Hi {{contact.first_name}} from {{client.name}} — [read more](https://example.com/article)' },
      { step_order: 2, delay_minutes: 60, subject: 'Following up', body_template: 'Second touch' },
    ]);

    const enrollment = await enrollContactInternal(db, tenantId, sequence.sequence_id, contactId, userId);
    expect(enrollment).toMatchObject({ current_step_order: 0, state: 'active' });
    // Step 1 has zero delay: due immediately.
    expect(Math.abs(new Date(enrollment.next_send_at).getTime() - Date.now())).toBeLessThan(10_000);

    const t0 = new Date();
    const firstRun = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: t0 });
    expect(firstRun).toEqual({ sent: 1, completed: 0, stopped: 0, failed: 0, skipped: 0 });

    // The idempotent send log carries the delivered claim (B2).
    const sendLog = await tenantTable('marketing_sequence_sends')
      .where({ tenant: tenantId, enrollment_id: enrollment.enrollment_id, step_id: steps[0].step_id })
      .first();
    expect(sendLog).toMatchObject({ status: 'sent' });

    // The send went through the outbound email abstraction, to the contact.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const sendParams = sendEmailMock.mock.calls[0][0];
    expect(sendParams).toMatchObject({
      to: 'ada@example.com',
      contactId,
      entityType: 'marketing_sequence_step',
      entityId: steps[0].step_id,
    });
    const rendered = await sendParams.templateProcessor.process({});
    expect(rendered.subject).toBe('Welcome Ada');
    expect(rendered.html).toContain('Hi Ada from Sequence Client');
    // Unsubscribe link (F049) points at this enrollment.
    expect(rendered.html).toContain(`/api/marketing/unsubscribe/${tenantId}/${enrollment.enrollment_id}`);

    // Click links are HMAC-signed at send time (M5) and the signature
    // verifies for this tenant/enrollment/step.
    const clickMatch = rendered.html.match(/href="[^"]*\/api\/marketing\/track\/click\/[^"?]+\?u=([^&"]+)&s=([0-9a-f]+)"/);
    expect(clickMatch).toBeTruthy();
    const signedUrl = decodeURIComponent(clickMatch![1]);
    expect(signedUrl).toBe('https://example.com/article');
    expect(verifyTrackingDestination(SIGNING_SECRET, {
      tenant: tenantId,
      enrollmentId: enrollment.enrollment_id,
      stepId: steps[0].step_id,
      url: signedUrl,
    }, clickMatch![2])).toBe(true);

    // Enrollment advanced to step 1, next send scheduled from step 2's delay.
    const afterFirst = await getEnrollment(enrollment.enrollment_id);
    expect(afterFirst).toMatchObject({ current_step_order: 1, state: 'active' });
    const expectedNext = t0.getTime() + 60 * 60_000;
    expect(Math.abs(new Date(afterFirst.next_send_at).getTime() - expectedNext)).toBeLessThan(5_000);

    // 'Marketing: Email Sent' interaction recorded and linked to step 1.
    const sentType = await db('system_interaction_types')
      .where({ type_name: 'Marketing: Email Sent' })
      .first('type_id');
    const sentInteraction = await tenantTable('interactions')
      .where({ tenant: tenantId, type_id: sentType.type_id, contact_name_id: contactId })
      .first();
    expect(sentInteraction).toMatchObject({ title: 'Sequence email sent: Welcome Ada' });
    const sentEngagement = await tenantTable('marketing_engagements')
      .where({ tenant: tenantId, interaction_id: sentInteraction.interaction_id })
      .first();
    expect(sentEngagement).toMatchObject({ step_id: steps[0].step_id });

    // Not yet due: an immediate re-run sends nothing (idempotence between runs).
    const immediateRerun = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: new Date(t0.getTime() + 60_000) });
    expect(immediateRerun).toEqual({ sent: 0, completed: 0, stopped: 0, failed: 0, skipped: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    // Advance past step 2's delay: the final step sends and — per the F047
    // state machine — the enrollment completes with nothing left to send.
    const t1 = new Date(t0.getTime() + 61 * 60_000);
    const secondRun = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: t1 });
    expect(secondRun).toEqual({ sent: 1, completed: 0, stopped: 0, failed: 0, skipped: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock.mock.calls[1][0]).toMatchObject({
      to: 'ada@example.com',
      entityId: steps[1].step_id,
    });

    const afterSecond = await getEnrollment(enrollment.enrollment_id);
    expect(afterSecond.current_step_order).toBe(2);
    expect(afterSecond.state).toBe('completed');
    expect(afterSecond.next_send_at).toBeNull();

    expect(await marketingInteractionCount('Marketing: Email Sent', contactId)).toBe(2);
  });

  it('M3: editing a sequence preserves step identity (step_ids survive by step_order)', async () => {
    const { sequence, steps } = await createActiveSequence('Editable drip', [
      { step_order: 1, delay_minutes: 0, subject: 'First' },
      { step_order: 2, delay_minutes: 60, subject: 'Second' },
    ]);

    await updateSequenceInternal(db, tenantId, sequence.sequence_id, {
      steps: [
        { step_order: 1, delay_minutes: 0, subject: 'First (edited)', body_template: 'body' },
        { step_order: 2, delay_minutes: 120, subject: 'Second', body_template: 'body' },
        { step_order: 3, delay_minutes: 240, subject: 'Third (new)', body_template: 'body' },
      ],
    });

    const after = await tenantTable('marketing_sequence_steps')
      .where({ tenant: tenantId, sequence_id: sequence.sequence_id })
      .orderBy('step_order', 'asc');
    expect(after).toHaveLength(3);
    // Existing orders kept their ids — historical stats and delivered
    // tracking URLs stay valid.
    expect(after[0].step_id).toBe(steps[0].step_id);
    expect(after[1].step_id).toBe(steps[1].step_id);
    expect(after[0].subject).toBe('First (edited)');
    expect(after[1].delay_minutes).toBe(120);
    expect(after[2].subject).toBe('Third (new)');

    // Dropping a trailing step deletes only that step.
    await updateSequenceInternal(db, tenantId, sequence.sequence_id, {
      steps: [
        { step_order: 1, delay_minutes: 0, subject: 'First (edited)', body_template: 'body' },
        { step_order: 2, delay_minutes: 120, subject: 'Second', body_template: 'body' },
      ],
    });
    const trimmed = await tenantTable('marketing_sequence_steps')
      .where({ tenant: tenantId, sequence_id: sequence.sequence_id })
      .orderBy('step_order', 'asc');
    expect(trimmed.map((s: { step_id: string }) => s.step_id)).toEqual([steps[0].step_id, steps[1].step_id]);
  });

  it('B2: an existing claim for the due step is skipped without a second send', async () => {
    const contactId = await createContactWithEmail('Claimed Contact', 'claimed@example.com');
    const { sequence, steps } = await createActiveSequence('Claimed drip', [
      { step_order: 1, delay_minutes: 0, subject: 'Only once' },
    ]);
    const enrollment = await enrollContactInternal(db, tenantId, sequence.sequence_id, contactId, userId);

    // Simulate another runner having already delivered this step.
    await tenantTable('marketing_sequence_sends').insert({
      tenant: tenantId,
      enrollment_id: enrollment.enrollment_id,
      step_id: steps[0].step_id,
      status: 'sent',
      claimed_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    });

    const summary = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: new Date() });
    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('B2: a failed send releases the claim, rewinds the enrollment, and retries after backoff', async () => {
    const contactId = await createContactWithEmail('Flaky SMTP', 'flaky@example.com');
    const { sequence, steps } = await createActiveSequence('Flaky drip', [
      { step_order: 1, delay_minutes: 0, subject: 'Eventually delivered' },
    ]);
    const enrollment = await enrollContactInternal(db, tenantId, sequence.sequence_id, contactId, userId);

    sendEmailMock.mockResolvedValueOnce({ success: false, error: 'SMTP rejected' });
    const t0 = new Date();
    const failedRun = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: t0 });
    expect(failedRun.failed).toBe(1);
    expect(failedRun.sent).toBe(0);

    // Claim released ('failed'), enrollment rewound to its pre-claim step
    // with a 30-minute backoff.
    const failedLog = await tenantTable('marketing_sequence_sends')
      .where({ tenant: tenantId, enrollment_id: enrollment.enrollment_id, step_id: steps[0].step_id })
      .first();
    expect(failedLog).toMatchObject({ status: 'failed', error: 'SMTP rejected' });
    const afterFailure = await getEnrollment(enrollment.enrollment_id);
    expect(afterFailure).toMatchObject({ current_step_order: 0, state: 'active' });
    expect(Math.abs(new Date(afterFailure.next_send_at).getTime() - (t0.getTime() + 30 * 60_000))).toBeLessThan(5_000);

    // No email interaction was recorded for the failed attempt.
    expect(await marketingInteractionCount('Marketing: Email Sent', contactId)).toBe(0);

    // After the backoff the same step is retaken and delivered exactly once.
    const t1 = new Date(t0.getTime() + 31 * 60_000);
    const retryRun = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: t1 });
    expect(retryRun.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const retriedLog = await tenantTable('marketing_sequence_sends')
      .where({ tenant: tenantId, enrollment_id: enrollment.enrollment_id, step_id: steps[0].step_id })
      .first();
    expect(retriedLog).toMatchObject({ status: 'sent', error: null });
    expect(await marketingInteractionCount('Marketing: Email Sent', contactId)).toBe(1);
  });

  it('T006: a suppressed contact receives zero sends and the enrollment is stopped', async () => {
    const contactId = await createContactWithEmail('Suppress Me', 'suppress-me@example.com');
    const { sequence } = await createActiveSequence('Suppressed drip', [
      { step_order: 1, delay_minutes: 0, subject: 'Should never arrive' },
    ]);
    const enrollment = await enrollContactInternal(db, tenantId, sequence.sequence_id, contactId, userId);
    expect(enrollment.state).toBe('active');

    await db.transaction((trx) =>
      addSuppression(trx, tenantId, {
        email: 'suppress-me@example.com',
        contactId,
        reason: 'manual',
        source: 'admin',
      }),
    );

    const summary = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: new Date() });
    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();

    const after = await getEnrollment(enrollment.enrollment_id);
    expect(after.state).toBe('stopped');
    expect(after.next_send_at).toBeNull();
  });

  it('T007: unsubscribe suppresses immediately, stops all enrollments for the address, and survives contact re-import', async () => {
    // Two contacts sharing one address, each actively enrolled: stopping by
    // contact_id alone would miss the second enrollment — the email join in
    // addSuppression is what catches it.
    const contactA = await createContactWithEmail('Original Contact', 'shared@example.com');
    const contactB = await createContactWithEmail('Duplicate Contact', 'shared@example.com');
    const { sequence: sequenceOne } = await createActiveSequence('Drip one', [
      { step_order: 1, delay_minutes: 0, subject: 'One' },
    ]);
    const { sequence: sequenceTwo } = await createActiveSequence('Drip two', [
      { step_order: 1, delay_minutes: 0, subject: 'Two' },
    ]);
    const enrollmentA = await enrollContactInternal(db, tenantId, sequenceOne.sequence_id, contactA, userId);
    const enrollmentB = await enrollContactInternal(db, tenantId, sequenceTwo.sequence_id, contactB, userId);

    const unsubscribed = await unsubscribeEnrollmentInternal(db, tenantId, enrollmentA.enrollment_id);
    expect(unsubscribed).toEqual({ email: 'shared@example.com' });

    const suppression = await tenantTable('marketing_suppressions')
      .where({ tenant: tenantId, email: 'shared@example.com' })
      .first();
    expect(suppression).toMatchObject({ reason: 'unsubscribe', source: 'link', contact_id: contactA });

    // Every active enrollment for the address stopped — A via contact_id,
    // B via the email join.
    expect((await getEnrollment(enrollmentA.enrollment_id)).state).toBe('stopped');
    expect((await getEnrollment(enrollmentB.enrollment_id)).state).toBe('stopped');

    // Delete contact A outright (M12): enrollments and marketing_contact_state
    // cascade away with the contact; the suppression's contact_id is SET NULL
    // by its own FK, so the email-keyed suppression survives.
    await tenantTable('contacts')
      .where({ tenant: tenantId, contact_name_id: contactA })
      .del();
    expect(
      await tenantTable('marketing_sequence_enrollments')
        .where({ tenant: tenantId, enrollment_id: enrollmentA.enrollment_id })
        .first(),
    ).toBeUndefined();

    const survivingSuppression = await tenantTable('marketing_suppressions')
      .where({ tenant: tenantId, email: 'shared@example.com' })
      .first();
    expect(survivingSuppression).toBeDefined();
    expect(survivingSuppression.contact_id).toBeNull();
    expect(await isSuppressed(db, tenantId, 'shared@example.com')).toBe(true);

    // Re-import the same address as a brand-new contact.
    const contactC = await createContactWithEmail('Reimported Contact', 'SHARED@example.com');

    // The enrollment path refuses suppressed addresses outright...
    await expect(
      enrollContactInternal(db, tenantId, sequenceTwo.sequence_id, contactC, userId),
    ).rejects.toThrow(/suppressed/i);

    // ...and the send loop is the hard backstop: even an enrollment that
    // exists anyway (bulk import, race) is stopped without a send.
    const rogueEnrollmentId = uuidv4();
    await tenantTable('marketing_sequence_enrollments').insert({
      tenant: tenantId,
      enrollment_id: rogueEnrollmentId,
      sequence_id: sequenceTwo.sequence_id,
      contact_id: contactC,
      current_step_order: 0,
      state: 'active',
      next_send_at: new Date().toISOString(),
      enrolled_by: userId,
    });

    const summary = await sendDueSequenceStepsInternal(db, tenantId, { baseUrl: BASE_URL, signingSecret: SIGNING_SECRET, now: new Date() });
    expect(summary.sent).toBe(0);
    expect(summary.stopped).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect((await getEnrollment(rogueEnrollmentId)).state).toBe('stopped');
  });
});
