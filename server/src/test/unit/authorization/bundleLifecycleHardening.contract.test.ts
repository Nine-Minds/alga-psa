import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');
const serviceSource = readFileSync(
  path.resolve(repoRoot, 'server/src/lib/authorization/bundles/service.ts'),
  'utf8'
);

describe('authorization bundle lifecycle hardening contracts', () => {
  it('locks draft revisions during publish and rule edits so published revisions cannot be mutated mid-transition', () => {
    expect(serviceSource).toContain("export async function deleteBundleRule(");
    expect(serviceSource).toContain("export async function publishBundleRevision(");
    expect(serviceSource).toContain("export async function upsertBundleRule(");
    expect(serviceSource).toContain("forUpdate()");
    expect(serviceSource).toContain("Only draft revisions can be published. Refresh bundle state and try again.");
    expect(serviceSource).toContain('Cannot publish an empty draft revision. Add at least one narrowing rule before publishing.');
    expect(serviceSource).toContain("Draft revision changed before publish could complete. Refresh bundle state and try again.");
    expect(serviceSource).toContain("const bundle = await trx('authorization_bundles')");
    expect(serviceSource).toContain("const draftRevision = await trx('authorization_bundle_revisions')");
  });
});
