import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('Temporal compiler output executes frozen Unicode lowercase in native Node ESM', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'temporal-predicate-runtime-'));
  try {
    const configPath = path.join(root, 'ee/temporal-workflows/tsconfig.build.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    assert.deepEqual(parsed.errors, []);
    const sourceRoot = path.join(root, 'packages/predicates/src');
    const program = ts.createProgram([path.join(sourceRoot, 'unicodeLower.ts')], {
      ...parsed.options,
      rootDir: sourceRoot,
      outDir: directory,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      incremental: false,
    });
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }));
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }));

    const unicode = JSON.parse(readFileSync(path.join(sourceRoot, 'unicodeLower.v1.json'), 'utf8'));
    const lower = Array.from(unicode.lower);
    const cases = [
      ['', ''], ['İ', 'i\u0307'], ['ΟΣ', 'ος'], ['ΟΣΑ', 'οσα'],
      ['Ο\u0301Σ', 'ο\u0301ς'], ['Σ', 'σ'], ['AΣ\u0301B', 'aσ\u0301b'],
      ['ÉCOLE 𐐀', 'école 𐐨'], ['\ua7ce', '\ua7ce'],
      ['A\ua7ceΣ', 'a\ua7ceσ'], ['ΑΣ\ua7ce', 'ας\ua7ce'],
      ...Array.from(unicode.upper, (character, index) => [character, lower[index]]),
    ];
    const entry = pathToFileURL(path.join(directory, 'unicodeLower.js')).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import { readFileSync } from 'node:fs';
      const { unicodeLowerV1 } = await import(${JSON.stringify(entry)});
      const inputs = JSON.parse(readFileSync(0, 'utf8'));
      process.stdout.write(JSON.stringify(inputs.map(unicodeLowerV1)));
    `], { input: JSON.stringify(cases.map(([input]) => input)), encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), cases.map(([, expected]) => expected));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
