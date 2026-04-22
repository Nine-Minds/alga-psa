import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(
    __dirname,
    '../../../../migrations/20260422143000_enforce_authorization_revision_lifecycle_uniqueness.cjs'
  ),
  'utf8'
);

describe('authorization bundle revision lifecycle uniqueness migration', () => {
  it('enforces a single draft and single published revision per tenant bundle', () => {
    expect(migration).toContain('authorization_bundle_revisions_single_draft_idx');
    expect(migration).toContain("WHERE lifecycle_state = 'draft'");
    expect(migration).toContain('authorization_bundle_revisions_single_published_idx');
    expect(migration).toContain("WHERE lifecycle_state = 'published'");
  });
});
