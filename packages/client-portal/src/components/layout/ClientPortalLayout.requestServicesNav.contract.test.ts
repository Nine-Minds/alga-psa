import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('ClientPortalLayout request services navigation contract', () => {
  it('T016: renders a first-class Request Services navigation link for authenticated client portal users', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, './ClientPortalSidebar.tsx'),
      'utf8'
    );

    expect(source).toMatch(/['"]\/client-portal\/request-services['"]/);
    expect(source).toContain("t('nav.requestServices', 'Request Services')");
  });
});
