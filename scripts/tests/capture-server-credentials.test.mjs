import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractServerCredentials } from '../../e2e-tests/harness/capture-server-credentials.mjs';
const pair = (email, password) => `server | *** User Email is -> [ ${email} ] ***\nserver | *** Password is -> [ ${password} ] ***\n`;

test('latest complete pair replaces credentials from an earlier boot', () => {
  assert.deepEqual(extractServerCredentials(pair('old@example.test', 'old-secret') + 'startup noise\n' + pair('new@example.test', 'new-secret')),
    { email: 'new@example.test', password: 'new-secret' });
});

test('missing, orphaned and ambiguous announcements fail instead of reusing stale credentials', () => {
  for (const logs of ['', 'Password is -> [ orphan ]', 'User Email is -> [ a ]\nUser Email is -> [ b ]\nPassword is -> [ x ]',
    pair('old@example.test', 'old-secret') + 'User Email is -> [ newer@example.test ]']) {
    assert.throws(() => extractServerCredentials(logs));
  }
});

test('CLI masks command data and writes exact values through multiline outputs without logging input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'credential-capture-'));
  try {
    const output = join(dir, 'output');
    const password = 'synthetic%0A::warning::value';
    const cli = new URL('../../e2e-tests/harness/capture-server-credentials.mjs', import.meta.url);
    const result = spawnSync(process.execPath, [cli.pathname], { input: `private log payload\n${pair('test@example.test', password)}`,
      env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '::add-mask::synthetic%250A::warning::value\n');
    const text = readFileSync(output, 'utf8');
    const match = /^e2e_user_email<<([^\n]+)\ntest@example.test\n\1\ne2e_user_password<<\1\n([^\n]+)\n\1\n$/.exec(text);
    assert.ok(match);
    assert.equal(match[2], password);
    const failed = spawnSync(process.execPath, [cli.pathname], { input: 'private log payload\nPassword is -> [ secret ]',
      env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.doesNotMatch(failed.stderr, /private log payload|secret/);
    assert.equal(readFileSync(output, 'utf8'), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
