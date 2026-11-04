import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('service-principals Turbopack entry alias', () => {
  it.each([
    ['community', 'oss'],
    ['enterprise', 'ee'],
  ])('compiles the %s edition entry and its import graph', (edition, implementation) => {
    const expected = `../packages/product-service-principals/${implementation}/entry.ts`;
    const script = `
      import path from 'node:path';
      import ts from 'typescript';
      import config from './next.config.mjs';
      const target = config.turbopack.resolveAlias['@product/service-principals/entry'];
      const serverDir = process.cwd();
      if (target !== ${JSON.stringify(expected)}) {
        throw new Error('Unexpected alias target: ' + target);
      }
      const entry = path.resolve(serverDir, target);
      const configPath = path.join(serverDir, 'tsconfig.json');
      const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n'));
        },
      });
      if (!parsed) throw new Error('Unable to load server tsconfig');
      const program = ts.createProgram([entry], {
        ...parsed.options,
        paths: {
          ...parsed.options.paths,
          '@ee/*': ['../ee/server/src/*'],
        },
        noEmit: false,
        declaration: false,
        incremental: false,
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      const unresolved = diagnostics.filter((diagnostic) => diagnostic.code === 2307);
      if (unresolved.length) {
        throw new Error(unresolved.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n')
        ).join('\\n'));
      }
      const emitted = [];
      const result = program.emit(undefined, (fileName, contents) => {
        if (fileName.endsWith('.js')) emitted.push(contents);
      });
      if (result.emitSkipped || emitted.length === 0) {
        throw new Error('Selected alias entry did not compile to JavaScript');
      }
      console.log(JSON.stringify({ target, entry, emittedFiles: emitted.length }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: serverDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        EDITION: edition === 'enterprise' ? 'enterprise' : 'community',
        NEXT_PUBLIC_EDITION: edition,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output.target).toBe(expected);
    expect(output.entry).toBe(path.resolve(serverDir, expected));
    expect(output.emittedFiles).toBeGreaterThan(0);
  });
});
