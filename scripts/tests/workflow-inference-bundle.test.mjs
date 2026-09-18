import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));

test('enterprise production aliases bundle a callable workflow inference service', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workflow-inference-bundle-'));
  const previous = process.env.EDITION;
  process.env.EDITION = 'enterprise';
  try {
    const runtime = require('next/dist/compiled/webpack/webpack');
    const webpack = runtime.webpack;
    const { default: nextConfig } = await import('../../server/next.config.mjs');
    symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'));
    const loader = path.join(directory, 'typescript-loader.cjs');
    writeFileSync(loader, `const ts = require(${JSON.stringify(require.resolve('typescript'))}); module.exports = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;`);
    const provider = path.join(directory, 'provider.cjs');
    writeFileSync(provider, `exports.resolveChatProvider = async (tenant, feature) => {
      if (tenant !== 'bundle-tenant' || feature !== 'workflow-inference') throw Error('Wrong provider request');
      return { providerId: 'openrouter', model: 'bundle-model', requestOverrides: { resolveTurnOverrides: () => ({}) },
        client: { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) } } } };
    }; exports.toAiCreditsError = () => null;
    exports.notifyAiCreditsUnavailable = async () => { throw Error('Unexpected credits notification'); };`);
    const entry = path.join(directory, 'entry.ts');
    writeFileSync(entry, `export { inferWorkflowStructuredOutput } from ${JSON.stringify(path.join(root, 'packages/ee/src/services/workflowInferenceService.ts'))};`);
    const configuration = nextConfig.webpack({
      mode: 'production', target: 'node', context: root, entry,
      output: { path: directory, filename: 'bundle.cjs', library: { type: 'commonjs2' } },
      resolve: { extensions: ['.ts', '.js', '.json'], alias: {} },
      module: { rules: [{ test: /\.ts$/, use: loader }] }, plugins: [],
      externals: [({ context, request }, callback) => {
        const requestedPath = path.resolve(context, request).replace(/\.ts$/, '');
        if (['services/chatProviderResolver', 'lib/aiGateway/errors', 'lib/aiGateway/notifications'].some(relative =>
          requestedPath === path.join(root, 'ee/server/src', relative))) {
          // Only the external provider boundary is replaced; edition resolution,
          // wrappers and schema/retry implementation use production source.
          assert.ok(context.includes('/ee/server/src/services'), 'Enterprise must use the EE provider boundary');
          return callback(null, `commonjs ${provider}`);
        }
        callback();
      }],
    }, { isServer: true, dev: false });
    configuration.cache = false;
    configuration.optimization = { ...configuration.optimization, minimize: false };
    const compiler = webpack(configuration);
    let stats;
    try {
      stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
    } finally {
      await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    }
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    assert.equal(stats.hasWarnings(), false, stats.toString({ all: false, warnings: true }));
    const { inferWorkflowStructuredOutput } = require(path.join(directory, 'bundle.cjs'));
    assert.deepEqual(await inferWorkflowStructuredOutput({ tenantId: 'bundle-tenant', runId: 'bundle-run', stepPath: 'root.ai',
      prompt: 'Return success', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }), { ok: true });
  } finally {
    if (previous === undefined) delete process.env.EDITION; else process.env.EDITION = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
