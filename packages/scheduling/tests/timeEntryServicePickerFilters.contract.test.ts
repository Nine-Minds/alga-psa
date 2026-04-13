import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTimeEntryServicesSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../src/actions/timeEntryServices.ts'),
    'utf8'
  );
}

describe('time entry service picker filters', () => {
  it('limits time entry services to hourly catalog services', () => {
    const source = readTimeEntryServicesSource();

    expect(source).toContain("'sc.item_kind': 'service'");
    expect(source).toContain("'sc.billing_method': 'hourly'");
    expect(source).not.toContain("query = query.where('sc.billing_method', 'usage')");
  });
});
