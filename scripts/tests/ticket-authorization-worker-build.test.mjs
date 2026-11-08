import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workerRequire = createRequire(path.join(root, 'services/workflow-worker/package.json'));
const ts = workerRequire('typescript');

test('ticket authorization compiles for the worker after its package is built', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ticket-authorization-worker-'));
  try {
    const source = path.join(root, 'packages/authorization');
    cpSync(path.join(source, 'src'), path.join(directory, 'src'), { recursive: true });
    cpSync(path.join(source, 'package.json'), path.join(directory, 'package.json'));
    symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'));

    // Match the Docker build order without modifying the checkout's dist tree.
    // The emitted JS must exist: without it, self-imports can fall back to types
    // and hide the worker compiler's package-exports resolution failure.
    execFileSync(process.execPath, [
      path.join(root, 'node_modules/tsup/dist/cli-default.js'),
      '--config', path.join(source, 'tsup.config.ts'),
    ], { cwd: directory, stdio: 'pipe' });

    const configPath = path.join(root, 'services/workflow-worker/tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    assert.deepEqual(parsed.errors, []);
    const program = ts.createProgram([path.join(directory, 'src/ticketRecordAuthorization.ts')], {
      ...parsed.options,
      rootDir: path.parse(root).root,
      noEmit: true,
      incremental: false,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
