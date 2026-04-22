import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(
    __dirname,
    '../../../../migrations/20260422113000_enforce_authorization_rule_revision_bundle_integrity.cjs'
  ),
  'utf8'
);

describe('authorization bundle rule/revision integrity migration', () => {
  it('fails with an actionable error when preexisting drifted rule rows are present', () => {
    expect(migration).toContain("whereRaw('r.bundle_id <> rev.bundle_id')");
    expect(migration).toContain('Cannot enforce authorization rule/revision bundle integrity because existing rule rows reference a different bundle than their revision.');
  });

  it('replaces the rule foreign key with tenant+bundle+revision integrity', () => {
    expect(migration).toContain("dropForeign(['tenant', 'revision_id'])");
    expect(migration).toContain("foreign(['tenant', 'bundle_id', 'revision_id'])");
  });
});
