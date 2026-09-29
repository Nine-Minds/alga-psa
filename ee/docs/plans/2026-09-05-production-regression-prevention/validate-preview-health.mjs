import { execFileSync, spawnSync } from 'node:child_process';
import { SourceTextModule, createContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
if (!process.argv[2]) throw new Error('Provide the composite workflow YAML path');
const template = JSON.parse(execFileSync('yq', ['-o=json', '.spec.templates[] | select(.name == "preview-smoke-test")', process.argv[2]], { encoding: 'utf8' }));
async function run(mode) {
  const urls = [];
  const context = createContext({ AbortSignal, process: { env: { TARGET_COLOR: mode === 'color' ? 'unexpected' : 'green' } }, console: { log() {} }, fetch: async (url, options) => {
    urls.push(url);
    if (mode === 'network') throw new Error('Connection refused');
    if (url.endsWith('/')) return { ok: mode !== 'root', status: mode === 'root' ? 500 : 200, body: { cancel: async () => {} } };
    assert.equal(options.redirect, 'error');
    if (mode === 'redirect') throw new Error('Redirect forbidden');
    return { status: mode === 'health' ? 503 : 200, json: async () => {
      if (mode === 'html') throw new SyntaxError('Not JSON');
      return { status: mode === 'body' ? 'degraded' : 'ok' };
    } };
  } });
  const module = new SourceTextModule(template.container.args[0], { context });
  await module.link(() => { throw new Error('Unexpected import'); });
  await module.evaluate(); return urls;
}
test('healthy preview reaches successful completion', async () => {
  assert.deepEqual(await run('pass'), ['https://green.algapsa.com/', 'https://green.algapsa.com/api/health']);
});
for (const mode of ['color', 'network', 'root', 'health', 'redirect', 'html', 'body']) test(`preview blocks ${mode} failure`, async () => {
  await assert.rejects(run(mode));
});
test('container command executes validation before network access', () => {
  const result = spawnSync(process.execPath, [...template.container.command.slice(1), ...template.container.args], {
    env: { ...process.env, TARGET_COLOR: 'invalid' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /Invalid preview color/);
});
