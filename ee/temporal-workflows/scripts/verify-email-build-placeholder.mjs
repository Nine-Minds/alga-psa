import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = new URL('.', import.meta.url);
const loader = fileURLToPath(new URL('./redirect-worker-email-to-placeholder.mjs', scriptDirectory));
const verifier = fileURLToPath(new URL('./verify-email-build.mjs', scriptDirectory));
for (const consumer of ['escalation', 'sla-notification']) {
  const result = spawnSync(process.execPath, ['--import', loader, verifier], {
    encoding: 'utf8',
    env: { ...process.env, WORKER_EMAIL_REDIRECT_CONSUMER: consumer },
  });
  assert.equal(result.status, 1,
    `the ${consumer} redirection should fail with an assertion/runtime error, got status ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /WORKER_EMAIL_PLACEHOLDER_SENTINEL/,
    `the ${consumer} negative check must fail specifically because its selectively redirected import executed the placeholder`);
}
console.log('Emitted worker escalation and SLA notification guards rejected selectively redirected throwing placeholders.');
