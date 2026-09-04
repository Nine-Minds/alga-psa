import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');
const routePath = 'server/src/app/msp/settings/secrets/page.tsx';
const routeSource = fs.readFileSync(path.join(repoRoot, routePath), 'utf8');
const screenSource = fs.readFileSync(
  path.join(repoRoot, 'server/src/components/settings/secrets/SecretsManagement.tsx'),
  'utf8',
);

describe('secrets settings route', () => {
  it('is tracked, unignored, and composed in the shared settings shell', () => {
    expect(execFileSync('git', ['ls-files', routePath], { cwd: repoRoot, encoding: 'utf8' }).trim()).toBe(routePath);
    const ignored = spawnSync('git', ['check-ignore', routePath], { cwd: repoRoot, encoding: 'utf8' });
    expect(ignored.status).toBe(1);
    expect(ignored.stdout.trim()).toBe('');
    expect(routeSource).toContain('<SettingsTab tabId="secrets">');
    expect(routeSource).toContain('<SecretsManagement />');
    expect(routeSource).toContain("settingsTabMetadata('secrets')");
  });

  it('surfaces permission and durability guards and disables all mutations', () => {
    expect(screenSource).toContain('permissionDenied');
    expect(screenSource).toContain("storagePosture.reason === 'NO_DURABLE_PATH'");
    expect(screenSource.match(/disabled={!storagePosture\.writable \|\| permissionDenied}/g)).toHaveLength(3);
  });
});
