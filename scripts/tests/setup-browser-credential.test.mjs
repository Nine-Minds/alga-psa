import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const scenario of ['success', 'wrong-owner', 'provision-failure']) {
  test(`browser credential handoff: ${scenario}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-credential-'));
    try {
      const command = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args.includes('ps')) console.log('fixture-server');
else if (args[0] === 'inspect') console.log(JSON.stringify({
 'com.docker.compose.project': process.env.SCENARIO === 'wrong-owner' ? 'other-stack' : 'alga-e2e-test',
 'com.docker.compose.service': 'server'
}));
else if (args[0] === 'exec') {
 fs.writeFileSync(process.env.INPUT, fs.readFileSync(0));
 if (process.env.SCENARIO === 'provision-failure') { console.error('private dependency details'); process.exit(1); }
}
`;
      for (const name of ['docker-compose', 'docker']) writeFileSync(join(dir, name), command, { mode: 0o755 });
      const output = join(dir, 'output');
      const input = join(dir, 'input');
      const calls = join(dir, 'calls');
      const result = spawnSync(process.execPath, ['e2e-tests/harness/setup-browser-credential.mjs'], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output, INPUT: input, CALLS: calls, SCENARIO: scenario }, encoding: 'utf8',
      });
      const commands = readFileSync(calls, 'utf8');
      if (scenario === 'success') {
        assert.equal(result.status, 0, result.stderr);
        const password = readFileSync(input, 'utf8');
        assert.match(password, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(result.stdout, `::add-mask::${password}\n`);
        assert.ok(readFileSync(output, 'utf8').includes(`\n${password}\n`));
        assert.ok(readFileSync(output, 'utf8').includes('\nglinda@emeraldcity.oz\n'));
        assert.ok(!commands.includes(password), 'password must travel on stdin, not command arguments');
      } else {
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.equal(existsSync(output), false);
        assert.doesNotMatch(result.stderr, /private dependency details/);
        if (scenario === 'wrong-owner') assert.doesNotMatch(commands, /"exec"|"cp"/);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
