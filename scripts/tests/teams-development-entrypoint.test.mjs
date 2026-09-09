import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../../e2e-tests/harness/start-teams-development-ci.mjs', import.meta.url));
for (const [name, nodeEnv, mode] of [['production override', 'production', 'true'], ['missing opt-in', 'development', 'false']]) {
  test(`Teams development startup rejects ${name} before credential access or server startup`, () => {
    const child = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 5000,
      env: { PATH: process.env.PATH, NODE_ENV: nodeEnv, TEAMS_EMULATOR_MODE: mode } });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /requires explicit development configuration/);
    assert.doesNotMatch(child.stderr, /ENOENT|Missing NEXTAUTH_SECRET/);
    assert.equal(child.stdout, '');
  });
}
