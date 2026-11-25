import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import type { Configuration, Stats } from 'webpack';

const nodeRequire = createRequire(import.meta.url);
const { webpack } = nodeRequire('next/dist/compiled/webpack/webpack') as typeof import('webpack');

describe('preview polyfill lookup in a production bundle', () => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'preview-pagination-bundle-')));
  const buildRoot = path.join(directory, 'build');
  const runtimeRoot = path.join(directory, 'runtime');
  const packageRoot = path.join(runtimeRoot, 'node_modules/pagedjs');
  const polyfillPath = path.join(packageRoot, 'dist/paged.polyfill.min.js');
  const bundlePath = path.join(buildRoot, 'preview.cjs');

  beforeAll(async () => {
    mkdirSync(buildRoot, { recursive: true });
    mkdirSync(path.join(runtimeRoot, 'server'), { recursive: true });
    mkdirSync(path.join(packageRoot, 'lib'), { recursive: true });
    mkdirSync(path.dirname(polyfillPath), { recursive: true });
    writeFileSync(path.join(runtimeRoot, 'package.json'), '{}');
    writeFileSync(path.join(runtimeRoot, 'server/package.json'), '{}');
    // Match pagedjs's exports map: its dist bundle is not an exported subpath.
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: 'pagedjs', exports: { '.': { require: './lib/index.cjs' } },
    }));
    writeFileSync(path.join(packageRoot, 'lib/index.cjs'), 'module.exports = {};');
    writeFileSync(polyfillPath, '/* runtime polyfill fixture */');

    // Compile the real module with Next's production webpack. Source-only tests
    // miss webpack replacing createRequire(...).resolve(...) with a module ID.
    const source = readFileSync(path.join(__dirname, 'previewPagination.server.ts'), 'utf8');
    const entry = path.join(buildRoot, 'preview.mjs');
    writeFileSync(entry, ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText);
    const unusedDependencies = path.join(buildRoot, 'unused.cjs');
    writeFileSync(unusedDependencies, 'module.exports = {};');
    const configuration: Configuration = {
      mode: 'production',
      target: 'node',
      context: buildRoot,
      entry,
      // Next compiles application modules as javascript/auto; native .mjs
      // parsing skips webpack's CommonJS/createRequire rewriting entirely.
      module: { rules: [{ test: /preview\.mjs$/, type: 'javascript/auto' }] },
      output: { path: buildRoot, filename: 'preview.cjs', library: { type: 'commonjs2' } },
      optimization: { minimize: false },
      // Keep the browser/rendering dependencies outside this resolver test;
      // pagedjs stays external exactly as it does in server/next.config.mjs.
      externals: [({ request }, callback) => {
        if (request === 'pagedjs') return callback(null, 'commonjs pagedjs');
        if (request?.startsWith('.')) return callback(null, `commonjs ${unusedDependencies}`);
        callback();
      }],
    };
    const compiler = webpack(configuration)!;
    try {
      const stats = await new Promise<Stats>((resolve, reject) => {
        compiler.run((error, result) => error ? reject(error) : resolve(result!));
      });
      expect(stats.hasErrors(), stats.toString({ all: false, errors: true })).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        compiler.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it.each(['.', 'server'])('resolves the installed file when started from %s', (cwd) => {
    // The build tree has no pagedjs. Resolution must use the relocated runtime
    // installation, including the hoisted node_modules above server/.
    const output = execFileSync(process.execPath, ['-e', `
      const fs = require('node:fs');
      const { resolvePagedPolyfillPath } = require(${JSON.stringify(bundlePath)});
      const file = resolvePagedPolyfillPath();
      console.log(JSON.stringify({ file, contents: fs.readFileSync(file, 'utf8') }));
    `], { cwd: path.join(runtimeRoot, cwd), encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual({ file: polyfillPath, contents: '/* runtime polyfill fixture */' });
  });
});
