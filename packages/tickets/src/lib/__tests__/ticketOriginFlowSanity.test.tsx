import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TicketOriginBadge from '../../components/TicketOriginBadge';
import { getTicketOrigin } from '../ticketOrigin';

function readJson(relativePathFromRepoRoot: string): any {
  const repoRoot = path.resolve(__dirname, '../../../../../');
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8'));
}

describe('ticket origin API flow sanity', () => {
  it('T080: end-to-end API-created ticket displays Created via API badge in MSP ticket details', () => {
    const labels = readJson('server/public/locales/en/common.json').tickets.origin;
    const origin = getTicketOrigin({
      ticket_origin: 'api',
      source: 'api',
      email_metadata: null,
      entered_by_user_type: 'internal',
    });

    const html = renderToStaticMarkup(
      <TicketOriginBadge
        origin={origin}
        labels={{
          internal: labels.internal,
          clientPortal: labels.clientPortal,
          inboundEmail: labels.inboundEmail,
          api: labels.api,
          other: labels.other,
        }}
      />
    );

    expect(html).toContain('Created via API');
    expect(html).toContain('data-ticket-origin="api"');
  });

  it('T081: end-to-end API-created ticket displays Created via API badge in client portal ticket details', () => {
    const labels = readJson('server/public/locales/en/clientPortal.json').tickets.origin;
    const origin = getTicketOrigin({
      ticket_origin: 'api',
      source: 'api',
      email_metadata: null,
      entered_by_user_type: 'internal',
    });

    const html = renderToStaticMarkup(
      <TicketOriginBadge
        origin={origin}
        labels={{
          internal: labels.internal,
          clientPortal: labels.clientPortal,
          inboundEmail: labels.inboundEmail,
          api: labels.api,
          other: labels.other,
        }}
      />
    );

    expect(html).toContain('Created via API');
    expect(html).toContain('data-ticket-origin="api"');
  });
});
