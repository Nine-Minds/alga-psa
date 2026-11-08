import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FR-E7b: a shared-workspace colleague may read an open ticket about the hot
 * desk, but the write paths resolve the ticket *without* the workspace clause
 * and answer "Ticket not found". Before this the portal happily showed the
 * comment box and the status control, and the submit failed.
 */
const source = fs.readFileSync(path.resolve(__dirname, './client-tickets.ts'), 'utf8');
const detailsSource = fs.readFileSync(
  path.resolve(__dirname, '../../components/tickets/TicketDetails.tsx'),
  'utf8',
);
const conversationSource = fs.readFileSync(
  path.resolve(__dirname, '../../../../tickets/src/components/ticket/TicketConversation.tsx'),
  'utf8',
);

describe('shared-workspace tickets are read-only in the portal', () => {
  it('the details action computes can_interact with the in-memory matcher', () => {
    expect(source).toContain('ticketMatchesVisibility');
    expect(source).toMatch(/extractActiveWatcherContactIds\(ticket(Row)?\.attributes\)/);
    expect(source).toContain('can_interact: result.canInteract');
  });

  it('the reader is told why, and the write controls are off', () => {
    expect(detailsSource).toContain('can_interact');
    expect(detailsSource).toContain('portal-ticket-workspace-readonly');
    expect(detailsSource).toContain('disabled={!canInteract}');
    expect(detailsSource).toContain('readOnly={!canInteract}');
  });

  it('the shared conversation hides every way to add to the thread', () => {
    expect(conversationSource).toContain('readOnly = false,');
    expect(conversationSource).toContain('{!showEditor && !readOnly && (');
    expect(conversationSource).toContain('onReply={readOnly ? undefined :');
    expect(conversationSource).toContain('onEdit={readOnly || !dataSource.capabilities.commentOwnEdit ? undefined :');
  });
});
