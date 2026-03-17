import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('CreditManagement financial-artifact context copy', () => {
  it('documents recurring-source, transferred-credit, and financial-only credit states', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/billing-dashboard/CreditManagement.tsx'),
      'utf8'
    );

    expect(source).toContain('Transferred Recurring Credit');
    expect(source).toContain('Recurring Source');
    expect(source).toContain('Financial Only');
    expect(source).toContain('Lineage Missing');
    expect(source).toContain('No recurring service period');
    expect(source).toContain('Source invoice metadata could not be recovered. Treat this as financial-date context until lineage is repaired.');
    expect(source).toContain(
      'Credits stay financial artifacts, and recurring service periods appear only when the source invoice carried canonical coverage.'
    );
  });
});
