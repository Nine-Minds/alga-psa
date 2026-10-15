/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './StatusDialog.tsx'), 'utf8');
}

describe('status dialog default handling contract', () => {
  it('offers the default checkbox for the types that create records from a default', () => {
    const source = readSource();

    expect(source).toContain(
      "const supportsDefault = selectedStatusType === 'ticket' || selectedStatusType === 'interaction';",
    );
    expect(source).toContain('disabled={isClosed}');
  });

  it('never clears the default as a side effect of editing a legacy closed default', () => {
    const source = readSource();

    expect(source).toContain(
      "const isClosedDefault = !!editingStatus?.is_closed && !!editingStatus?.is_default;",
    );
    expect(source).toContain('if (checked && !isClosedDefault) {');
    expect(source).not.toContain('is_default: isDefault && !isClosed');
  });
});
