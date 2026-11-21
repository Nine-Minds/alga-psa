import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_FILE_SIZE_BYTES } from '@alga-psa/storage/config/storage';

const repo = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(repo, p), 'utf8');

const HELM_TEMPLATES = [
  'helm/templates/deployment.yaml',
  'helm/templates/deployment-dev.yaml',
  'helm/templates/dev-env/code-server/deployment.yaml',
  'helm/templates/hosted-env/code-server/deployment.yaml',
];

describe('one storage limit: every default equals packages/storage config', () => {
  it('is 500 MiB (matches production, which sets 524288000)', () => {
    expect(DEFAULT_MAX_FILE_SIZE_BYTES).toBe(524288000);
  });

  it.each(HELM_TEMPLATES)('%s defaults both provider limits to the code default', (file) => {
    const defaults = [...read(file).matchAll(/providers\.(local|s3)\.max_file_size \| default "?(\d+)"?/g)];
    expect(defaults.map((m) => m[1]).sort()).toEqual(['local', 's3']);
    for (const m of defaults) expect(Number(m[2])).toBe(DEFAULT_MAX_FILE_SIZE_BYTES);
  });

  it('helm/values.yaml sets the provider limits to the code default and keeps no second (locations) limit', () => {
    const values = read('helm/values.yaml');
    const limits = [...values.matchAll(/^\s+max_file_size:\s*"?(\d+)"?/gm)].map((m) => Number(m[1]));
    expect(limits).toEqual([DEFAULT_MAX_FILE_SIZE_BYTES, DEFAULT_MAX_FILE_SIZE_BYTES]);
    expect(values).not.toMatch(/^\s+locations:/m);
  });

  it('envConfig validates the same defaults for both providers', () => {
    const env = read('server/src/config/envConfig.ts');
    for (const name of ['STORAGE_LOCAL_MAX_FILE_SIZE', 'STORAGE_S3_MAX_FILE_SIZE']) {
      expect(new RegExp(`${name}: z\\.preprocess\\(coerceNumber, z\\.number\\(\\)\\.int\\(\\)\\.positive\\(\\)\\)\\.default\\(${DEFAULT_MAX_FILE_SIZE_BYTES}\\)`).test(env)).toBe(true);
    }
  });
});
