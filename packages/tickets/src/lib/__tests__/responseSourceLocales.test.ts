import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('response source locale keys', () => {
  it('T023: English locale contains response source keys and keeps existing ticket translations', () => {
    // Client-portal ticket translations moved from clientPortal.json to the
    // shared tickets feature namespace (top-level keys).
    const clientPortalLocalePath = path.resolve(
      __dirname,
      '../../../../../server/public/locales/en/features/tickets.json'
    );

    const locale = JSON.parse(fs.readFileSync(clientPortalLocalePath, 'utf8'));

    expect(locale?.responseSource?.clientPortal).toBe(
      'Received via Client Portal'
    );
    expect(locale?.responseSource?.inboundEmail).toBe(
      'Received via Inbound Email'
    );

    // Guard existing response-state translations in the same area.
    expect(locale?.responseState?.awaitingYourResponse).toBeTruthy();
    expect(locale?.responseState?.awaitingSupportResponse).toBeTruthy();
  });
});
