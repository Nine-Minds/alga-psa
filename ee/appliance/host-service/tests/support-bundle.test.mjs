import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSupportBundle } from '../support-bundle.mjs';

test('generateSupportBundle captures diagnostics and redacts sensitive values', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-support-bundle-'));
  const stateFile = path.join(tmp, 'install-state.json');
  const releaseSelectionFile = path.join(tmp, 'release-selection.json');
  const setupInputsFile = path.join(tmp, 'setup-inputs.json');
  const outputDir = path.join(tmp, 'out');
  const captureDir = path.join(tmp, 'capture');

  fs.writeFileSync(stateFile, JSON.stringify({ failure: { suspectedCause: 'token=abc123' } }));
  fs.writeFileSync(releaseSelectionFile, JSON.stringify({ runtime: { password: 'secret' } }));
  fs.writeFileSync(setupInputsFile, JSON.stringify({ appHostname: 'psa.example.com' }));

  const result = generateSupportBundle({
    kubeconfigPath: '/tmp/k3s.yaml',
    outputDir,
    stateFile,
    releaseSelectionFile,
    setupInputsFile,
    tempDir: captureDir,
    runCommand: (command) => {
      if (command.startsWith('tar -C ')) {
        const bundlePath = command.split(' -czf ')[1].replace(/\s+\.$/, '').trim();
        fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
        fs.writeFileSync(bundlePath, 'bundle');
        return { ok: true, stdout: '', stderr: '', status: 0 };
      }
      return {
        ok: true,
        stdout: `ran ${command} token=abc123 password=secret client-key-data: abcxyz`,
        stderr: '',
        status: 0
      };
    }
  });

  assert.equal(result.ok, true);
  assert.ok(result.bundlePath.endsWith('.tar.gz'));
  assert.equal(fs.existsSync(result.bundlePath), true);

  const journal = fs.readFileSync(path.join(captureDir, 'host', 'appliance-journal.txt'), 'utf8');
  assert.match(journal, /\[REDACTED\]/);
  assert.equal(journal.includes('abc123'), false);
  assert.equal(journal.includes('password=secret'), false);

  const stateSnapshot = fs.readFileSync(path.join(captureDir, 'meta', 'install-state.json'), 'utf8');
  assert.equal(stateSnapshot.includes('abc123'), false);
});
