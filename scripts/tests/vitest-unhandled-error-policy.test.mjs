import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isLostConsoleLogTeardown } from '../lib/vitest-unhandled-error-policy.mjs';

const teardown = (method) => ({
  name: 'EnvironmentTeardownError',
  message: `[vitest-worker]: Closing rpc while "${method}" was pending`,
});

test('drops a console log lost to the worker teardown race', () => {
  assert.equal(isLostConsoleLogTeardown(teardown('onUserConsoleLog')), true);
});

test('keeps every other pending rpc rejection', () => {
  assert.equal(isLostConsoleLogTeardown(teardown('onTaskUpdate')), false);
});

test('keeps unrelated unhandled errors', () => {
  assert.equal(isLostConsoleLogTeardown(new TypeError('Closing rpc while "onUserConsoleLog" was pending')), false);
  assert.equal(isLostConsoleLogTeardown({ message: 'boom' }), false);
  assert.equal(isLostConsoleLogTeardown(undefined), false);
});
