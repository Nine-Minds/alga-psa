import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(
    __dirname,
    '../../../../migrations/20260421190000_create_authorization_bundle_control_plane.cjs'
  ),
  'utf8'
);

describe('authorization bundle control-plane migration', () => {
  it('creates bundle, revision, rule, and assignment tables', () => {
    expect(migration).toContain("createTable('authorization_bundles'");
    expect(migration).toContain("createTable('authorization_bundle_revisions'");
    expect(migration).toContain("createTable('authorization_bundle_rules'");
    expect(migration).toContain("createTable('authorization_bundle_assignments'");
  });

  it('keeps assignment targeting generic and tenant-scoped', () => {
    expect(migration).toContain("table.text('target_type').notNullable()");
    expect(migration).toContain("table.uuid('target_id').notNullable()");
    expect(migration).toContain("target_type IN ('role', 'team', 'user', 'api_key')");
    expect(migration).toContain("table.unique(['tenant', 'bundle_id', 'target_type', 'target_id'])");
  });

  it('enforces lifecycle and narrowing-only rule shape', () => {
    expect(migration).toContain("lifecycle_state IN ('draft', 'published', 'archived')");
    expect(migration).toContain("status IN ('active', 'archived')");
    expect(migration).toContain("status IN ('active', 'disabled')");
    expect(migration).toContain("effect = 'narrow'");
  });
});
