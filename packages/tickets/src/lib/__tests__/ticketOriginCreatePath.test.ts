import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';

const UUIDS = {
  tenant: '11111111-1111-4111-8111-111111111111',
  board: '22222222-2222-4222-8222-222222222222',
  client: '33333333-3333-4333-8333-333333333333',
  status: '44444444-4444-4444-8444-444444444444',
  priority: '55555555-5555-4555-8555-555555555555',
  user: '66666666-6666-4666-8666-666666666666',
};

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../../');
  return fs.readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ticket origin create-path persistence contracts', () => {
  it('T010: MSP server action create path persists ticket_origin=internal', () => {
    const source = readRepoFile('packages/tickets/src/actions/ticketActions.ts');

    expect(source).toContain("ticket_origin: TICKET_ORIGINS.INTERNAL");
  });

  it('T011: client portal create path persists ticket_origin=client_portal', () => {
    const source = readRepoFile('packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');

    expect(source).toContain("ticket_origin: TICKET_ORIGINS.CLIENT_PORTAL");
  });

  it('T012: inbound email create path persists ticket_origin=inbound_email', () => {
    const source = readRepoFile('shared/workflow/actions/emailWorkflowActions.ts');

    expect(source).toContain("ticket_origin: TICKET_ORIGINS.INBOUND_EMAIL");
  });

  it('T013: API create path persists ticket_origin=api', () => {
    const source = readRepoFile('server/src/lib/api/services/TicketService.ts');

    expect(source).toContain("ticket_origin: TICKET_ORIGINS.API");
  });

  it('T014: workflow/automation ticket creation without explicit origin persists internal default', async () => {
    const insertMock = vi.fn().mockResolvedValue(undefined);

    const trx = Object.assign(
      (table: string) => {
        if (table === 'tickets') {
          return {
            insert: insertMock,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
      {
        raw: vi.fn().mockResolvedValue({ rows: [{ number: 'T-1001' }] }),
      }
    ) as any;

    vi.spyOn(TicketModel, 'validateBusinessRules').mockResolvedValue({ valid: true });

    await TicketModel.createTicket(
      {
        title: 'Workflow-created ticket',
        board_id: UUIDS.board,
        client_id: UUIDS.client,
        status_id: UUIDS.status,
        priority_id: UUIDS.priority,
        description: 'Created by workflow runtime',
        entered_by: UUIDS.user,
      },
      UUIDS.tenant,
      trx
    );

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_origin: 'internal',
      })
    );
  });
});
