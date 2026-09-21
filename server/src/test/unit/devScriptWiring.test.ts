import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the `npm run dev` launch wiring: development must run the custom
 * entrypoint that owns the `upgrade` event, not Next's built-in dev server
 * (which leaves unrecognized upgrades hanging).
 */
describe('development launch wiring', () => {
  const serverDir = path.resolve(import.meta.dirname, '../../..');

  it('runs the custom dev entrypoint instead of nx next:dev', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(serverDir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts.dev).toContain('dev-server.ts');
    expect(pkg.scripts.dev).not.toContain('next:dev');
  });

  it('routes dev:turbo through the custom dev entrypoint too', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(serverDir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts['dev:turbo']).toContain('dev-server.ts');
    expect(pkg.scripts['dev:turbo']).not.toContain('next:dev');
  });

  it('wires the real upgrade handler with HMR delegation in the dev entrypoint', () => {
    const source = readFileSync(
      path.join(serverDir, 'dev-server.ts'),
      'utf8',
    );

    expect(source).toContain("from './src/lib/http/upgradeHandling'");
    expect(source).toContain('attachNextUpgradeHandler');
    expect(source).toContain('delegateHmrToNext');
  });
});
