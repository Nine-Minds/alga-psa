import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('RMM ticket-created event usage', () => {
  it('uses TicketModelEventPublisher with source metadata for RMM ticket-created events', () => {
    const helper = readRepoFile('shared/rmm/alerts/ticketCreatedEvent.ts');

    expect(helper).toContain(
      "import { TicketModelEventPublisher } from '@alga-psa/tickets/lib/adapters/TicketModelEventPublisher'",
    );
    expect(helper).toContain('new TicketModelEventPublisher(trx)');
    expect(helper).toContain("metadata: { source }");
  });

  it('shared automatic processing publishes TICKET_CREATED only for created tickets', () => {
    const source = readRepoFile('shared/rmm/alerts/processRmmAlertEvent.ts');

    expect(source).toContain("if (result.outcome === 'ticket_created' && result.ticketId)");
    expect(source).toContain('await publishRmmTicketCreated({');
    expect(source).toContain('source: event.provider');
    expect(source).toContain("outcome: 'occurrence_appended'");

    const occurrenceBlock = source.slice(
      source.indexOf("outcome: 'occurrence_appended'") - 700,
      source.indexOf("outcome: 'occurrence_appended'") + 300,
    );
    expect(occurrenceBlock).not.toContain('publishRmmTicketCreated');
  });

  it('manual createTicketForAlertId publishes after the transaction returns', () => {
    const source = readRepoFile('shared/rmm/alerts/createTicketForAlertId.ts');
    const transactionIndex = source.indexOf('const created = await knex.transaction');
    const publishIndex = source.indexOf('await publishRmmTicketCreated({');

    expect(transactionIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(transactionIndex);
    expect(source).toContain('source: alert.provider');
  });

  it('Huntress queues TICKET_CREATED through the transaction-bound publisher on create only', () => {
    const source = readRepoFile('ee/server/src/lib/integrations/huntress/incidents/incidentProcessor.ts');

    expect(source).toContain('await publishRmmTicketCreated({');
    expect(source).toContain('trx,');
    expect(source).toContain("source: 'huntress'");

    const appendNoteBlock = source.slice(
      source.indexOf("if (action.kind === 'append_note'"),
      source.indexOf('return undefined;'),
    );
    expect(appendNoteBlock).not.toContain('publishRmmTicketCreated');
  });
});
