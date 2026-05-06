import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('Algadesk inbound email DB coverage contracts', () => {
  it('T016: integration suite contains inbound ticket-creation coverage for defaults mapping and sender/contact resolution', () => {
    const integrationSource = read('src/test/integration/inboundEmailInApp.webhooks.integration.test.ts');

    expect(integrationSource).toContain('creates 1 ticket + 1 initial comment');
    expect(integrationSource).toContain("description: 'Test defaults'");
    expect(integrationSource).toContain('Unmatched sender: inbound email is treated as customer-authored');

    const sharedUnitSource = read('../shared/services/email/__tests__/processInboundEmailInApp.test.ts');
    expect(sharedUnitSource).toContain('new inbound email with matched contact+user forwards both author_id and contact_id');
    expect(sharedUnitSource).toContain('new inbound email with matched contact-only sender forwards contact_id and omits author_id');
  });

  it('T017: integration suite contains inbound reply comment threading + dedupe coverage', () => {
    const integrationSource = read('src/test/integration/inboundEmailInApp.webhooks.integration.test.ts');

    expect(integrationSource).toContain("expect(second.outcome).toBe('deduped')");
    expect(integrationSource).toContain('inReplyTo: originalMessageId');

    const sharedUnitSource = read('../shared/services/email/__tests__/processInboundEmailInApp.additionalPaths.test.ts');
    expect(sharedUnitSource).toContain('findTicketByReplyTokenMock');
    expect(sharedUnitSource).toContain("matchedBy: 'thread_headers'");
  });
});
