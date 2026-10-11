import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const requiredEvidence = new Map([
  ['.github/workflows/integration-tests.yml', [
    'infrastructure-shard-${{ matrix.shard }}',
    'infrastructure-execution-evidence',
    'workspace-db-evidence',
  ]],
  ['.github/workflows/e2e-fresh-install-tests.yaml', [
    'fresh-install-api-${{ matrix.edition }}',
    'supported-upgrade-execution',
    'supported-citus-upgrade-execution',
    'teams-development-execution',
    'microsoft-callback-execution',
  ]],
  ['.github/workflows/temporal-readiness.yml', ['temporal-readiness-execution']],
  ['.github/workflows/citus-migration-smoke.yml', ['temporal-database-execution']],
]);

test('raw evidence needed by production readiness survives the readiness retention window', () => {
  for (const [file, artifactNames] of requiredEvidence) {
    const workflow = yaml.load(readFileSync(file, 'utf8'));
    const uploads = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
      .filter(step => step.uses?.startsWith('actions/upload-artifact@'));

    for (const name of artifactNames) {
      const upload = uploads.find(step => step.with?.name === name);
      assert.ok(upload, `${file} must upload ${name}`);
      assert.ok(upload.with['retention-days'] >= 30,
        `${name} must remain downloadable for failed-job reruns for at least 30 days`);
    }
  }
});
