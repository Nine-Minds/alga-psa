// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../..', relativePath), 'utf8');
}

/**
 * The smart search gates (permission, release flag, AI add-on, key) are decided
 * in each list page's server component and handed to the client as a prop, so
 * the affordance is right on first paint. The `@enterprise` alias resolves to a
 * stub that answers unavailable in community edition.
 */
describe('smart search availability is decided in the page server components', () => {
  it.each([
    ['src/app/msp/tickets/page.tsx', 'ticket', '<MspTicketsPageClient'],
    ['src/app/msp/projects/page.tsx', 'project', '<Projects'],
  ])('%s evaluates the %s gate on the server and passes it down', (page, entity, element) => {
    const source = read(page);
    expect(source).toContain("import { getSmartSearchAvailability } from '@enterprise/lib/actions/smartSearchActions';");
    expect(source).toContain(`getSmartSearchAvailability('${entity}')`);
    expect(source).toContain('.catch(() => false)');
    const render = source.slice(source.indexOf(element));
    expect(render).toContain('smartSearchAvailable={smartSearchAvailable}');
  });
});
