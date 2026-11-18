import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'ContactDetailsEdit.tsx'), 'utf8');

describe('ContactDetailsEdit duplicate-email handling', () => {
  it('shows the specific EMAIL_EXISTS detail (who owns the address) instead of discarding it for a fixed generic string', () => {
    const start = source.indexOf("case 'EMAIL_EXISTS':");
    const end = source.indexOf("case 'FOREIGN_KEY_ERROR':", start);
    expect(start).toBeGreaterThan(-1);
    const branch = source.slice(start, end);

    expect(branch).toContain('detail');
    expect(branch).toContain('contactDetailsEdit.errors.emailExistsPrefix');
    // The generic text survives only as the fallback for an empty detail.
    expect(branch).toMatch(/detail\s*\?/);
  });
});
