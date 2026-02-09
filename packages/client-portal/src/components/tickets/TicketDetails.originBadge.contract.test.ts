import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TICKET_ORIGINS } from '@alga-psa/types';
import { getTicketOrigin } from '@alga-psa/tickets/lib/ticketOrigin';

function readTicketDetailsSource(): string {
  const filePath = path.resolve(__dirname, './TicketDetails.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

describe('client portal TicketDetails origin badge contract', () => {
  it('T043: renders origin badge when origin is inbound_email', () => {
    const source = readTicketDetailsSource();
    const resolvedOrigin = getTicketOrigin({ email_metadata: { messageId: 'm-1' } });

    expect(resolvedOrigin).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
    expect(source).toContain('<TicketOriginBadge');
    expect(source).toContain('origin={ticketOrigin}');
  });

  it('T044: renders origin badge when origin is client_portal', () => {
    const source = readTicketDetailsSource();
    const resolvedOrigin = getTicketOrigin({
      source: null,
      entered_by_user_type: 'client',
      email_metadata: null,
    });

    expect(resolvedOrigin).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
    expect(source).toContain('const ticketOrigin = useMemo(() => getTicketOrigin(ticket as any), [ticket]);');
  });

  it('T045: renders internal badge fallback for unresolved/legacy records', () => {
    const source = readTicketDetailsSource();
    const resolvedOrigin = getTicketOrigin({
      source: null,
      entered_by_user_type: null,
      email_metadata: null,
    });

    expect(resolvedOrigin).toBe(TICKET_ORIGINS.INTERNAL);
    expect(source).toContain("internal: t('tickets.origin.internal', 'Created Internally')");
  });

  it('T061: ResponseStateBadge behavior remains wired after origin badge insertion (client portal view)', () => {
    const source = readTicketDetailsSource();

    expect(source).toContain('<ResponseStateBadge');
    expect(source).toContain("responseState={(ticket as any).response_state as TicketResponseState}");
  });
});
