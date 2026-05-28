import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd(), '..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('app-wide search deploy contracts', () => {
  it('T151 documents SEARCH_INDEX_LIVE default and Helm wiring', () => {
    const envExample = readRepoFile('.env.example');
    const helmValues = readRepoFile('helm/values.yaml');
    const helmDeployment = readRepoFile('helm/templates/deployment.yaml');

    expect(envExample).toContain('# App-wide Search');
    expect(envExample).toContain('SEARCH_INDEX_LIVE=false');
    expect(envExample).toContain('Default false for rollout safety');
    expect(helmValues).toContain('searchIndexLive: false');
    expect(helmValues).toContain('Keep false during migration/backfill');
    expect(helmDeployment).toContain('- name: SEARCH_INDEX_LIVE');
    expect(helmDeployment).toContain('.Values.server.searchIndexLive | default false');
  });

  it('T152 documents the migrate/backfill/live-enable search deploy sequence', () => {
    const runbook = readRepoFile('docs/deployment/app-wide-search-runbook.md');
    const migrateIndex = runbook.indexOf('npm run migrate');
    const disabledIndex = runbook.indexOf('SEARCH_INDEX_LIVE=false');
    const backfillIndex = runbook.indexOf('npm run search:backfill');
    const enabledIndex = runbook.indexOf('SEARCH_INDEX_LIVE=true');

    expect(migrateIndex).toBeGreaterThanOrEqual(0);
    expect(disabledIndex).toBeGreaterThan(migrateIndex);
    expect(backfillIndex).toBeGreaterThan(disabledIndex);
    expect(enabledIndex).toBeGreaterThan(backfillIndex);
    expect(runbook).toContain('roll the server/workers');
    expect(runbook).toContain('search:reconcile');
  });
});
