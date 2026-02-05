import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

const readFile = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf-8');

describe('Server pages include MspSchedulingProvider', () => {
  it('wraps ticket detail page with MspSchedulingProvider', () => {
    const content = readFile('server/src/app/msp/tickets/[id]/page.tsx');
    expect(content).toContain('MspSchedulingProvider');
  });

  it('wraps contact detail and activity pages with MspSchedulingProvider', () => {
    const detail = readFile('server/src/app/msp/contacts/[id]/page.tsx');
    const activity = readFile('server/src/app/msp/contacts/[id]/activity/page.tsx');
    expect(detail).toContain('MspSchedulingProvider');
    expect(activity).toContain('MspSchedulingProvider');
  });

  it('wraps project detail page with MspSchedulingProvider', () => {
    const content = readFile('server/src/app/msp/projects/[id]/page.tsx');
    expect(content).toContain('MspSchedulingProvider');
  });
});
