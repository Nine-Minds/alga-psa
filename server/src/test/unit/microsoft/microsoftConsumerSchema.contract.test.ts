import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function repoPath(relativePath: string): string {
  return path.join(process.cwd(), '..', relativePath);
}

describe('microsoft consumer schema contracts', () => {
  it('T355/T356: shared Microsoft schema comments describe binding-driven consumer resolution instead of compatibility-default routing', () => {
    const profilesMigration = fs.readFileSync(
      repoPath('server/migrations/20260307120000_create_microsoft_profiles.cjs'),
      'utf8'
    );
    const bindingsMigration = fs.readFileSync(
      repoPath('server/migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs'),
      'utf8'
    );

    expect(profilesMigration).toContain('Consumer routing');
    expect(profilesMigration).toContain('microsoft_profile_consumer_bindings');
    expect(profilesMigration).not.toContain('compatibility source');

    expect(bindingsMigration).toContain('explicit binding row');
    expect(bindingsMigration).not.toContain('default compatibility');
    expect(bindingsMigration).not.toContain('compatibility source');
  });
});
