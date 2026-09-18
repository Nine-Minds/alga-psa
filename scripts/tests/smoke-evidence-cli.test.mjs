import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = fileURLToPath(new URL('../', import.meta.url));

for (const [name, status, output] of [
  ['capture-microsoft-email-smoke-evidence.mjs', 1, /Expected command:/],
  ['verify-microsoft-email-smoke-evidence.mjs', 2, /Usage:/],
]) {
  test(`${name} invokes its CLI through a symlinked parent directory`, (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-evidence-cli-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const linkedScripts = path.join(temporary, 'scripts');
    fs.symlinkSync(scripts, linkedScripts, 'dir');
    const result = spawnSync(process.execPath, [path.join(linkedScripts, name)], { encoding: 'utf8' });
    assert.equal(result.status, status, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, output);
  });
}
