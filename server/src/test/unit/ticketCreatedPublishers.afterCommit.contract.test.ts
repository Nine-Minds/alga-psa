import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('ticket creation publisher commit ordering', () => {
  it('binds client-portal ticket events to the creating transaction', () => {
    const source = readRepoFile('packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');

    expect(source).toContain('const eventPublisher = new ServerEventPublisher(trx)');
    expect(source).toContain('await eventPublisher.publishTicketAssigned({');
  });

  it('binds Teams message-extension ticket events to an owned transaction', () => {
    const source = readRepoFile('ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionRegistry.ts');

    expect(source).toContain('await withTransaction(knex, (trx: any) =>');
    expect(source).toContain('new ServerEventPublisher(trx)');
  });

  it('binds non-durable inbound-email ticket events to the admin transaction', () => {
    const source = readRepoFile('shared/workflow/actions/emailWorkflowActions.ts');

    expect(source).toContain('new WorkflowEventPublisher({ transaction: trx })');
  });
});
