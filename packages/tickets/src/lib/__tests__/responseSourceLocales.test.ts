import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('response source locale keys', () => {
  it('T023: English locale contains response source keys and keeps existing ticket translations', () => {
    const clientPortalLocalePath = path.resolve(
      __dirname,
      '../../../../../server/public/locales/en/clientPortal.json'
    );

    const locale = JSON.parse(fs.readFileSync(clientPortalLocalePath, 'utf8'));

    expect(locale?.tickets?.responseSource?.clientPortal).toBe(
      'Received via Client Portal'
    );
    expect(locale?.tickets?.responseSource?.inboundEmail).toBe(
      'Received via Inbound Email'
    );

    // Guard existing response-state translations in the same area.
    expect(locale?.tickets?.responseState?.awaitingYourResponse).toBeTruthy();
    expect(locale?.tickets?.responseState?.awaitingSupportResponse).toBeTruthy();
  });
});
