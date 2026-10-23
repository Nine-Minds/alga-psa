import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions retry renewal ticket wiring', () => {
  it('adds a manual retry action that re-attempts renewal ticket creation for failed work items', () => {
    expect(source).toContain("from '@alga-psa/shared/billingClients/renewalTicket';");
    expect(source).not.toContain('TicketModel');
    expect(source).not.toContain('ticket-create-composition');
    expect(source).toContain('return withTransaction(knex, async (trx) => {');
    expect(source).toContain('export type RenewalTicketRetryResult = {');
    expect(source).toContain('export const retryRenewalQueueTicketCreation = withAuth(async (');
    expect(source).toContain("const missingDefaultsError = 'Missing renewal ticket routing defaults for create_ticket policy';");
    expect(source).toContain("throw new Error('Manual retry is only available for due renewal cycles');");
    expect(source).toContain("whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
    expect(source).toContain('const idempotencyKey = buildRenewalTicketIdempotencyKey({');
    expect(source).toContain('const createdTicket = await createRenewalTicket(trx, tenant, {');
    expect(source).toContain("actor: { type: 'user', userId: user.user_id },");
    expect(source).toContain('source: RENEWAL_TICKET_MANUAL_RETRY_SOURCE,');
    expect(source).toContain('created_ticket_id: createdTicket.ticketId,');
    expect(source).toContain('automation_error: null,');
    expect(source).toContain('automation_error: errorMessage,');
    expect(source).toContain("if (effectivePolicy !== 'create_ticket') {");
    expect(source).toContain('retried: false,');
  });
});
