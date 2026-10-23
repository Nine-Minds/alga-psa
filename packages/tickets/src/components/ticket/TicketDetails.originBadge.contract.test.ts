import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TICKET_ORIGINS } from '@alga-psa/types';
import { getTicketOrigin } from '../../lib/ticketOrigin';

function readTicketDetailsSource(): string {
  const filePath = path.resolve(__dirname, './TicketDetails.tsx');
  return fs.readFileSync(filePath, 'utf8');
}

describe('MSP TicketDetails origin badge contract', () => {
  it('T050: MSP TicketDetails renders API origin badge when ticket_origin=api', () => {
    const source = readTicketDetailsSource();
    const resolvedOrigin = getTicketOrigin({ ticket_origin: 'api' });

    expect(resolvedOrigin).toBe(TICKET_ORIGINS.API);
    expect(source).toContain('<TicketOriginBadge');
    // Origin labels moved to the `features/tickets` namespace (top-level `origin.*` keys).
    expect(source).toContain("api: t('origin.api', 'Created via API')");
  });

  it('T051: MSP TicketDetails renders all other origin badges correctly (internal/client_portal/inbound_email)', () => {
    const source = readTicketDetailsSource();

    expect(getTicketOrigin({ ticket_origin: 'internal' })).toBe(TICKET_ORIGINS.INTERNAL);
    expect(getTicketOrigin({ ticket_origin: 'client_portal' })).toBe(TICKET_ORIGINS.CLIENT_PORTAL);
    expect(getTicketOrigin({ ticket_origin: 'inbound_email' })).toBe(TICKET_ORIGINS.INBOUND_EMAIL);

    // Origin labels moved to the `features/tickets` namespace (top-level `origin.*` keys).
    expect(source).toContain("internal: t('origin.internal', 'Created Internally')");
    expect(source).toContain("clientPortal: t('origin.clientPortal', 'Created via Client Portal')");
    expect(source).toContain("inboundEmail: t('origin.inboundEmail', 'Created via Inbound Email')");
  });

  it('T052: a structured origin link overrides the stored origin and feeds the badge tooltip', () => {
    const source = readTicketDetailsSource();

    // The origin link wins over both a stored origin and the internal creator.
    expect(
      getTicketOrigin({ ticket_origin: TICKET_ORIGINS.INTERNAL, origin_link_system: 'email' }),
    ).toBe(TICKET_ORIGINS.INBOUND_EMAIL);
    expect(
      getTicketOrigin({ ticket_origin: TICKET_ORIGINS.API, origin_link_system: 'client_portal' }),
    ).toBe(TICKET_ORIGINS.CLIENT_PORTAL);

    // TicketDetails resolves the origin link and passes the readable system
    // label through to the badge (never the raw key).
    expect(source).toContain('origin_link_system: originExternalLink?.system ?? null');
    expect(source).toContain('systemLabel={originExternalLink?.display.label ?? null}');
  });

  it('T071: existing response-state badge behavior remains unchanged in MSP ticket details', () => {
    const source = readTicketDetailsSource();

    expect(source).toContain('<ResponseStateBadge');
    expect(source).toContain('responseState={ticket.response_state}');
  });
});
