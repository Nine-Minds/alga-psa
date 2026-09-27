import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(__dirname, '../../../app');
const routeFile = path.join(appRoot, 'payment-methods/setup-complete/page.tsx');

describe('public card setup route layout boundary', () => {
  it('has no auth layout ancestor between the route and the root layout', () => {
    expect(fs.existsSync(routeFile)).toBe(true);
    const routeDirectory = path.dirname(routeFile);
    const layouts: string[] = [];
    let directory = routeDirectory;
    while (directory.startsWith(appRoot)) {
      const layout = path.join(directory, 'layout.tsx');
      if (fs.existsSync(layout)) layouts.push(path.relative(appRoot, layout));
      if (directory === appRoot) break;
      directory = path.dirname(directory);
    }

    expect(layouts).toEqual(['layout.tsx']);
    const rootLayout = fs.readFileSync(path.join(appRoot, 'layout.tsx'), 'utf8');
    expect(rootLayout).not.toMatch(/\bredirect\s*\(/);
    expect(rootLayout).not.toMatch(/\bgetSession(?:WithRevocationCheck)?\s*\(/);
  });
});
