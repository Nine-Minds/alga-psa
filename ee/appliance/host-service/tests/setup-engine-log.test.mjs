import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createSetupEngineLog } from '../setup-engine-log.mjs';

function tempLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-engine-log-'));
  return { dir, logFile: path.join(dir, 'state', 'setup-engine.log') };
}

function waitForExit(child) {
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
}

test('a detached child stdout and stderr both reach the log', async () => {
  const { logFile } = tempLog();
  const engineLog = createSetupEngineLog({ logFile, maxBytes: 10_000 });
  engineLog.append('[test] launching detached setup engine');

  const opened = engineLog.open();
  assert.equal(typeof opened.fd, 'number');

  // Same wiring as server.mjs: the child inherits the log fd for stdout+stderr,
  // the parent closes its copy, and the child writes both streams then fails.
  const child = spawn(process.execPath, [
    '-e',
    "process.stdout.write('engine stdout line\\n'); process.stderr.write('engine stderr line\\n'); process.exit(3);"
  ], { stdio: ['ignore', opened.fd, opened.fd] });
  fs.closeSync(opened.fd);

  const { code } = await waitForExit(child);
  assert.equal(code, 3);
  engineLog.append(`[test] child exited code=${code}`);

  const content = fs.readFileSync(logFile, 'utf8');
  assert.match(content, /engine stdout line/);
  assert.match(content, /engine stderr line/);
  assert.match(content, /child exited code=3/);
  assert.equal(engineLog.error, null);
  assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
});

test('an oversized log is rotated to .1 before the next launch', () => {
  const { logFile } = tempLog();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, 'previous launch output\n'.repeat(20));

  const engineLog = createSetupEngineLog({ logFile, maxBytes: 10 });
  const opened = engineLog.open();
  assert.equal(typeof opened.fd, 'number');
  fs.closeSync(opened.fd);

  assert.equal(fs.readFileSync(`${logFile}.1`, 'utf8'), 'previous launch output\n'.repeat(20));
  assert.equal(fs.readFileSync(logFile, 'utf8'), '');
});

test('an unopenable log returns an error and never throws', () => {
  const { dir } = tempLog();
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  const logFile = path.join(blocker, 'setup-engine.log');

  const engineLog = createSetupEngineLog({ logFile });
  const opened = engineLog.open();
  assert.equal(typeof opened.error, 'string');
  assert.equal(engineLog.error, opened.error);

  assert.equal(engineLog.append('ignored'), false);
  assert.equal(typeof engineLog.error, 'string');
});
