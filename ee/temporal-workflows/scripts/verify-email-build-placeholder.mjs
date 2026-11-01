import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = new URL('.', import.meta.url);
const loader = fileURLToPath(new URL('./redirect-worker-email-to-placeholder.mjs', scriptDirectory));
const verifier = fileURLToPath(new URL('./verify-email-build.mjs', scriptDirectory));
const result = spawnSync(process.execPath, ['--import', loader, verifier], {
  encoding: 'utf8',
  env: process.env,
});

assert.notEqual(result.status, 0,
  'the emitted worker email guard must fail when module resolution reaches a throwing placeholder');
console.log('Emitted worker email guard rejected the deliberately redirected throwing placeholder.');
