// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The contact-count chip on a location card is MSP-only: it expands to `/msp/contacts/...` links
 * and reading it is reading the client's contact roster. The client portal renders the very same
 * component, so the gate is asserted here rather than trusted.
 */

const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), 'utf8');

describe('ClientLocations contact chip', () => {
  const source = read('ClientLocations.tsx');

  it('only reads and renders the contacts when the caller asks for them', () => {
    expect(source).toContain('showContacts = true');
    expect(source).toContain('if (showContacts) {\n        const fetchedContacts = await getClientLocationContacts(clientId);');
    expect((source.match(/contacts=\{showContacts \? contactsByLocation/g) ?? []).length).toBe(2);
    // Nothing renders the chip or the MSP link outside that gate.
    expect(source).toContain('href={`/msp/contacts/${contact.contact_name_id}`}');
    expect(source.includes('contacts={contactsByLocation')).toBe(false);
  });

  it('is off in the client portal, in both the read-only line and the manage dialog', () => {
    const portal = read('../../../../client-portal/src/components/settings/ClientDetailsSettings.tsx');
    const usages = portal.match(/<ClientLocations[\s\S]*?\/>/g) ?? [];
    expect(usages).toHaveLength(2);
    for (const usage of usages) expect(usage).toContain('showContacts={false}');
  });

  it('asks for MSP client *and* contact read before listing who works where', () => {
    const actions = read('../../actions/clientLocationActions.ts');
    const action = actions.slice(actions.indexOf('export const getClientLocationContacts'));
    const body = action.slice(0, action.indexOf('export const getClientLocation ='));
    expect(body).toContain("assertMspPermission(\n        user,\n        'client',\n        'read',");
    expect(body).toContain("assertMspPermission(\n        user,\n        'contact',\n        'read',");
    expect(body).not.toContain('assertMspOrClientPortalOwnClientPermission');
  });
});
