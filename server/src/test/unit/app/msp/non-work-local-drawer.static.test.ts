import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appMspRoot = path.resolve(process.cwd(), 'src/app/msp');

describe('non-work local drawer outlets', () => {
  it('keeps generic drawer routes on a lightweight local outlet', () => {
    for (const relativePath of ['settings/layout.tsx', 'service-requests/layout.tsx']) {
      const source = fs.readFileSync(path.join(appMspRoot, relativePath), 'utf8');

      expect(source).toContain('LocalDrawerOutlet');
      expect(source).not.toContain('WorkspaceRouteLayout');
      expect(source).not.toContain('WorkspaceProviders');
    }
  });

  it('does not reintroduce the workspace stack into the shell layout', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/components/layout/DefaultLayout.tsx'), 'utf8');

    expect(source).not.toContain('WorkspaceProviders');
    expect(source).not.toContain('DrawerOutlet');
    expect(source).toContain('DrawerProvider');
  });
});
