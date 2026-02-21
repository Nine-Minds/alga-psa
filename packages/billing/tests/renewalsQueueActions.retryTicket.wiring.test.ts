import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions retry renewal ticket wiring', () => {
  it('adds a manual retry action that re-attempts renewal ticket creation for failed work items', () => {
    expect(source).toContain("import { TicketModel } from '@shared/models/ticketModel';");
    expect(source).toContain('export type RenewalTicketRetryResult = {');
    expect(source).toContain('export const retryRenewalQueueTicketCreation = withAuth(async (');
    expect(source).toContain("throw new Error('Renewal ticket automation columns are not available');");
    expect(source).toContain("throw new Error('Manual retry is only available for due renewal cycles');");
    expect(source).toContain("whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
    expect(source).toContain('const idempotencyKey = buildRenewalTicketIdempotencyKey({');
    expect(source).toContain('const createdTicket = await TicketModel.createTicketWithRetry(');
    expect(source).toContain('created_ticket_id: createdTicket.ticket_id,');
    expect(source).toContain('automation_error: null,');
    expect(source).toContain('automation_error: errorMessage,');
    expect(source).toContain("if (effectivePolicy !== 'create_ticket') {");
    expect(source).toContain('retried: false,');
  });
});
