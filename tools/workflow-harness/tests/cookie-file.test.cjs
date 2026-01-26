const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readCookieFromFile } = require('../lib/cookie.cjs');

test('T009: supports --cookie-file and trims newlines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-harness-cookie-'));
  const file = path.join(dir, 'cookie.txt');
  fs.writeFileSync(file, ' next-auth.session-token=abc123 \n\n', 'utf8');
  assert.equal(readCookieFromFile(file), 'next-auth.session-token=abc123');
});

