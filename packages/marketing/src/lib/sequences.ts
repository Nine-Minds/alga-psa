import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { TenantEmailService, type ITemplateProcessor } from '@alga-psa/email';
import type {
  IMarketingEnrollmentWithContact,
  IMarketingSequence,
  IMarketingSequenceEnrollment,
  IMarketingSequenceStep,
  IMarketingSequenceStepStats,
} from '@alga-psa/types';
import { applyMergeFields, markdownToHtml, markdownToText } from './render';
import { recordMarketingEngagement } from './engagements';
import { addSuppression, isSuppressed, normalizeEmail } from './suppression';
import type { SequenceInput } from '../schemas/marketingSchemas';

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listSequencesInternal(knex: Knex, tenant: string): Promise<IMarketingSequence[]> {
  const db = tenantDb(knex, tenant);
  return db.table('marketing_sequences').where({ tenant }).orderBy('created_at', 'desc');
}

function assertContiguousSteps(steps: SequenceInput['steps']): void {
  const orders = steps.map((s) => s.step_order).sort((a, b) => a - b);
  orders.forEach((order, index) => {
    if (order !== index + 1) {
      throw new Error('Step order must be contiguous starting at 1');
    }
  });
}

export async function createSequenceInternal(knex: Knex, tenant: string, input: SequenceInput, createdBy: string): Promise<IMarketingSequence> {
  assertContiguousSteps(input.steps);
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const [sequence] = await db.table('marketing_sequences')
      .insert({
        tenant,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? 'draft',
        created_by: createdBy,
      })
      .returning('*');
    for (const step of input.steps) {
      await db.table('marketing_sequence_steps').insert({ tenant, sequence_id: sequence.sequence_id, ...step });
    }
    return sequence as IMarketingSequence;
  });
}

export async function updateSequenceInternal(knex: Knex, tenant: string, sequenceId: string, input: Partial<SequenceInput>): Promise<IMarketingSequence> {
  if (input.steps) assertContiguousSteps(input.steps);
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const { steps, ...fields } = input;
    const [sequence] = await db.table('marketing_sequences')
      .where({ tenant, sequence_id: sequenceId })
      .update({ ...fields, updated_at: new Date().toISOString() })
      .returning('*');
    if (!sequence) throw new Error('Sequence not found');
    if (steps) {
      await db.table('marketing_sequence_steps').where({ tenant, sequence_id: sequenceId }).del();
      for (const step of steps) {
        await db.table('marketing_sequence_steps').insert({ tenant, sequence_id: sequenceId, ...step });
      }
    }
    return sequence as IMarketingSequence;
  });
}

export interface SequenceDetail {
  sequence: IMarketingSequence;
  steps: IMarketingSequenceStep[];
  stepStats: IMarketingSequenceStepStats[];
  enrollments: IMarketingEnrollmentWithContact[];
}

export async function getSequenceDetailInternal(knex: Knex, tenant: string, sequenceId: string): Promise<SequenceDetail | null> {
  const db = tenantDb(knex, tenant);
  const sequence = await db.table('marketing_sequences').where({ tenant, sequence_id: sequenceId }).first();
  if (!sequence) return null;

  const steps = await db.table('marketing_sequence_steps')
    .where({ tenant, sequence_id: sequenceId })
    .orderBy('step_order', 'asc') as IMarketingSequenceStep[];

  const statRows = await db.table('marketing_engagements as e')
    .join('interactions as i', function joinInteraction() {
      this.on('i.tenant', '=', 'e.tenant').andOn('i.interaction_id', '=', 'e.interaction_id');
    })
    .join('system_interaction_types as it', 'it.type_id', '=', 'i.type_id')
    .where({ 'e.tenant': tenant })
    .whereIn('e.step_id', steps.map((s) => s.step_id).concat(['__none__']))
    .groupBy('e.step_id', 'it.type_name')
    .select('e.step_id', 'it.type_name')
    .count('* as count') as Array<{ step_id: string; type_name: string; count: string | number }>;

  const stepStats: IMarketingSequenceStepStats[] = steps.map((step) => {
    const rows = statRows.filter((r) => r.step_id === step.step_id);
    const countOf = (name: string) => Number(rows.find((r) => r.type_name === name)?.count ?? 0);
    return {
      step_id: step.step_id,
      step_order: step.step_order,
      sent: countOf('Marketing: Email Sent'),
      opened: countOf('Marketing: Email Opened'),
      clicked: countOf('Marketing: Email Clicked'),
    };
  });

  const enrollments = await db.table('marketing_sequence_enrollments as e')
    .join('contacts as c', function joinContact() {
      this.on('c.tenant', '=', 'e.tenant').andOn('c.contact_name_id', '=', 'e.contact_id');
    })
    .where({ 'e.tenant': tenant, 'e.sequence_id': sequenceId })
    .select('e.*', 'c.full_name as contact_name', 'c.email as contact_email')
    .orderBy('e.created_at', 'desc') as Array<IMarketingSequenceEnrollment & { contact_name: string; contact_email: string }>;

  return {
    sequence: sequence as IMarketingSequence,
    steps,
    stepStats,
    enrollments: enrollments.map((row) => ({ ...row, step_count: steps.length })),
  };
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export async function enrollContactInternal(
  knex: Knex,
  tenant: string,
  sequenceId: string,
  contactId: string,
  enrolledBy: string,
): Promise<IMarketingSequenceEnrollment> {
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const sequence = await db.table('marketing_sequences')
      .where({ tenant, sequence_id: sequenceId })
      .first();
    if (!sequence) throw new Error('Sequence not found');
    if (sequence.status !== 'active') throw new Error('Only active sequences accept enrollments');

    const firstStep = await db.table('marketing_sequence_steps')
      .where({ tenant, sequence_id: sequenceId })
      .orderBy('step_order', 'asc')
      .first();
    if (!firstStep) throw new Error('Sequence has no steps');

    const contact = await db.table('contacts')
      .where({ tenant, contact_name_id: contactId })
      .first('email');
    if (!contact?.email) throw new Error('Contact has no email address');
    if (await isSuppressed(trx, tenant, contact.email)) {
      throw new Error('Contact is suppressed from marketing email');
    }

    const existing = await db.table('marketing_sequence_enrollments')
      .where({ tenant, sequence_id: sequenceId, contact_id: contactId, state: 'active' })
      .first('enrollment_id');
    if (existing) throw new Error('Contact is already enrolled in this sequence');

    const nextSendAt = new Date(Date.now() + firstStep.delay_minutes * 60_000).toISOString();
    const [enrollment] = await db.table('marketing_sequence_enrollments')
      .insert({
        tenant,
        sequence_id: sequenceId,
        contact_id: contactId,
        current_step_order: 0,
        state: 'active',
        next_send_at: nextSendAt,
        enrolled_by: enrolledBy,
      })
      .returning('*');
    return enrollment as IMarketingSequenceEnrollment;
  });
}

export async function unenrollContactInternal(knex: Knex, tenant: string, enrollmentId: string): Promise<void> {
  const db = tenantDb(knex, tenant);
  await db.table('marketing_sequence_enrollments')
    .where({ tenant, enrollment_id: enrollmentId, state: 'active' })
    .update({ state: 'stopped', updated_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Send loop (scheduled job body)
// ---------------------------------------------------------------------------

function inlineTemplate(subject: string, html: string, text: string): ITemplateProcessor {
  return { process: async () => ({ subject, html, text }) };
}

function trackableLinks(html: string, clickBase: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url: string) =>
    `href="${clickBase}?u=${encodeURIComponent(url)}"`);
}

export interface SequenceSendSummary {
  sent: number;
  completed: number;
  stopped: number;
  failed: number;
}

/**
 * Sends every due sequence step for the tenant. Claimed per enrollment with
 * row locks (skipLocked) and advanced with an optimistic current_step_order
 * guard, so overlapping job runs cannot double-send. Failed sends back off
 * 30 minutes without advancing; the enrollment stays visibly on its step.
 */
export async function sendDueSequenceStepsInternal(
  knex: Knex,
  tenant: string,
  options: { baseUrl: string; now?: Date; limit?: number },
): Promise<SequenceSendSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;
  const summary: SequenceSendSummary = { sent: 0, completed: 0, stopped: 0, failed: 0 };

  const due = await tenantDb(knex, tenant).table('marketing_sequence_enrollments as e')
    .join('marketing_sequences as s', function joinSequence() {
      this.on('s.tenant', '=', 'e.tenant').andOn('s.sequence_id', '=', 'e.sequence_id');
    })
    .where({ 'e.tenant': tenant, 'e.state': 'active', 's.status': 'active' })
    .where('e.next_send_at', '<=', now.toISOString())
    .orderBy('e.next_send_at', 'asc')
    .limit(limit)
    .select('e.enrollment_id') as Array<{ enrollment_id: string }>;

  for (const row of due) {
    try {
      const outcome = await sendOneEnrollmentStep(knex, tenant, row.enrollment_id, options.baseUrl, now);
      summary[outcome] += 1;
    } catch (error) {
      summary.failed += 1;
      // Back off without advancing; next run retries.
      await tenantDb(knex, tenant).table('marketing_sequence_enrollments')
        .where({ tenant, enrollment_id: row.enrollment_id, state: 'active' })
        .update({ next_send_at: new Date(now.getTime() + 30 * 60_000).toISOString() })
        .catch(() => {});
    }
  }
  return summary;
}

async function sendOneEnrollmentStep(
  knex: Knex,
  tenant: string,
  enrollmentId: string,
  baseUrl: string,
  now: Date,
): Promise<'sent' | 'completed' | 'stopped'> {
  // Claim and render inside a transaction; send outside it so SMTP latency
  // doesn't hold the lock. The optimistic guard on advance prevents a
  // double-send if two runners race past the lock window.
  const prepared = await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const enrollment = await db.table('marketing_sequence_enrollments')
      .where({ tenant, enrollment_id: enrollmentId, state: 'active' })
      .forUpdate()
      .first();
    if (!enrollment) return null;

    const step = await db.table('marketing_sequence_steps')
      .where({ tenant, sequence_id: enrollment.sequence_id, step_order: enrollment.current_step_order + 1 })
      .first();

    if (!step) {
      await db.table('marketing_sequence_enrollments')
        .where({ tenant, enrollment_id: enrollmentId, state: 'active' })
        .update({ state: 'completed', next_send_at: null, updated_at: now.toISOString() });
      return { kind: 'completed' as const };
    }

    const contact = await db.table('contacts')
      .where({ tenant, contact_name_id: enrollment.contact_id })
      .first('contact_name_id', 'full_name', 'email', 'client_id');

    if (!contact?.email || await isSuppressed(trx, tenant, contact.email)) {
      await db.table('marketing_sequence_enrollments')
        .where({ tenant, enrollment_id: enrollmentId, state: 'active' })
        .update({ state: 'stopped', next_send_at: null, updated_at: now.toISOString() });
      return { kind: 'stopped' as const };
    }

    let clientName = '';
    if (contact.client_id) {
      const client = await db.table('clients')
        .where({ tenant, client_id: contact.client_id })
        .first('client_name');
      clientName = client?.client_name ?? '';
    }

    // interactions.user_id is NOT NULL; fall back to the sequence owner for
    // enrollments that were created without an actor.
    let sendUserId = enrollment.enrolled_by as string | null;
    if (!sendUserId) {
      const sequence = await db.table('marketing_sequences')
        .where({ tenant, sequence_id: enrollment.sequence_id })
        .first('created_by');
      sendUserId = sequence?.created_by ?? null;
    }
    if (!sendUserId) {
      await db.table('marketing_sequence_enrollments')
        .where({ tenant, enrollment_id: enrollmentId, state: 'active' })
        .update({ state: 'stopped', next_send_at: null, updated_at: now.toISOString() });
      return { kind: 'stopped' as const };
    }

    const unsubscribeUrl = `${baseUrl}/api/marketing/unsubscribe/${tenant}/${enrollmentId}`;
    const clickBase = `${baseUrl}/api/marketing/track/click/${tenant}/${enrollmentId}/${step.step_id}`;
    const openPixel = `${baseUrl}/api/marketing/track/open/${tenant}/${enrollmentId}/${step.step_id}`;

    const mergeContext = {
      contact: { full_name: contact.full_name, email: contact.email },
      client: { client_name: clientName },
      extra: { unsubscribe_url: unsubscribeUrl },
    };
    const subject = applyMergeFields(step.subject, mergeContext);
    const mergedBody = applyMergeFields(step.body_template, mergeContext);

    const footer = `<p style="font-size:12px;color:#64748b">You are receiving this because you asked to hear from us. <a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
    const html = `${trackableLinks(markdownToHtml(mergedBody), clickBase)}${footer}<img src="${openPixel}" width="1" height="1" alt="" />`;
    const text = `${markdownToText(mergedBody)}\n\n---\nUnsubscribe: ${unsubscribeUrl}`;

    return {
      kind: 'send' as const,
      enrollment,
      step,
      contact,
      sendUserId,
      subject,
      html,
      text,
    };
  });

  if (!prepared) return 'stopped';
  if (prepared.kind === 'completed') return 'completed';
  if (prepared.kind === 'stopped') return 'stopped';

  const { enrollment, step, contact, sendUserId, subject, html, text } = prepared;

  const emailService = TenantEmailService.getInstance(tenant);
  await emailService.initialize();
  await emailService.sendEmail({
    to: contact.email,
    templateProcessor: inlineTemplate(subject, html, text),
    contactId: contact.contact_name_id,
    entityType: 'marketing_sequence_step',
    entityId: step.step_id,
  });

  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const following = await nextSendAt(db, tenant, enrollment.sequence_id, step.step_order, now);
    const advanced = await db.table('marketing_sequence_enrollments')
      .where({
        tenant,
        enrollment_id: enrollmentId,
        state: 'active',
        current_step_order: enrollment.current_step_order,
      })
      .update({
        current_step_order: step.step_order,
        // No following step: the sequence is finished — mark completed, not
        // merely unscheduled, so the completed branch is reachable.
        state: following ? 'active' : 'completed',
        next_send_at: following,
        updated_at: now.toISOString(),
      });
    if (!advanced) return; // another runner advanced it; the engagement below would double-log, so stop here

    await recordMarketingEngagement(trx, tenant, {
      typeName: 'Marketing: Email Sent',
      title: `Sequence email sent: ${subject}`,
      contactId: contact.contact_name_id,
      clientId: contact.client_id ?? null,
      userId: sendUserId,
      stepId: step.step_id,
      occurredAt: now.toISOString(),
    });
  });

  return 'sent';
}

async function nextSendAt(
  db: ReturnType<typeof tenantDb>,
  tenant: string,
  sequenceId: string,
  justSentOrder: number,
  now: Date,
): Promise<string | null> {
  const next = await db.table('marketing_sequence_steps')
    .where({ tenant, sequence_id: sequenceId, step_order: justSentOrder + 1 })
    .first('delay_minutes');
  if (!next) return null;
  return new Date(now.getTime() + next.delay_minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Unsubscribe (public endpoint body)
// ---------------------------------------------------------------------------

export async function unsubscribeEnrollmentInternal(
  knex: Knex,
  tenant: string,
  enrollmentId: string,
): Promise<{ email: string } | null> {
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const enrollment = await db.table('marketing_sequence_enrollments')
      .where({ tenant, enrollment_id: enrollmentId })
      .first('enrollment_id', 'contact_id');
    if (!enrollment) return null;

    const contact = await db.table('contacts')
      .where({ tenant, contact_name_id: enrollment.contact_id })
      .first('contact_name_id', 'email');
    if (!contact?.email) return null;

    await addSuppression(trx, tenant, {
      email: normalizeEmail(contact.email),
      contactId: contact.contact_name_id,
      reason: 'unsubscribe',
      source: 'link',
    });
    return { email: normalizeEmail(contact.email) };
  });
}
