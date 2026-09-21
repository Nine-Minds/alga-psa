import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config';

// One partition of the full server unit suite. scripts/run-server-unit-shard.mjs
// writes the assigned files (relative to server/) and points
// SERVER_UNIT_SHARD_FILES at them. An explicit include list selects exactly that
// partition; CLI positional filters substring-match, so foo.test.ts would also
// pull in foo.test.tsx from another shard.
const files = process.env.SERVER_UNIT_SHARD_FILES;
if (!files) throw new Error('SERVER_UNIT_SHARD_FILES must point at the assigned shard file list');
const include = JSON.parse(readFileSync(files, 'utf8'));
if (!Array.isArray(include) || !include.length || include.some((file) => typeof file !== 'string' || !file)) {
  throw new Error('Assigned shard file list is empty or invalid');
}

export default defineConfig({
  ...serverConfig,
  test: {
    ...serverConfig.test,
    include,
  },
});
