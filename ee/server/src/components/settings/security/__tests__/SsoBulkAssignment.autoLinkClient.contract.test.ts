import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'SsoBulkAssignment.tsx'), 'utf8');

describe('SSO bulk assignment auto-link contract', () => {
  it('T010/F024: exposes separate internal and client auto-link toggles and persists autoLinkClient independently', () => {
    expect(source).toContain('autoLinkInternalEnabled');
    expect(source).toContain('autoLinkClientEnabled');
    expect(source).toContain('updateSsoPreferencesAction({ autoLinkInternal: checked })');
    expect(source).toContain('updateSsoPreferencesAction({ autoLinkClient: checked })');
    expect(source).toContain('ssoBulk.autoLink.clientTitle');
    expect(source).toContain('ssoBulk.autoLink.internalTitle');
  });
});
