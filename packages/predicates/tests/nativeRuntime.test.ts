import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

it('builds a native Node package that executes the frozen Unicode mappings', () => {
  // Build independently of any existing dist or Vitest source aliases. Keep the
  // output inside the package so Node can resolve its external dependencies.
  const buildDirectory = mkdtempSync(path.join(packageRoot, '.native-runtime-'));
  try {
    cpSync(path.join(packageRoot, 'src'), path.join(buildDirectory, 'src'), { recursive: true });
    execFileSync(process.execPath, [
      require.resolve('tsup/dist/cli-default.js'), '--config', path.join(packageRoot, 'tsup.config.ts'),
    ], { cwd: buildDirectory, stdio: 'pipe', timeout: 30000 });

    const unicode = JSON.parse(readFileSync(path.join(packageRoot, 'src/unicodeLower.v1.json'), 'utf8'));
    const lower = Array.from(unicode.lower);
    const cases = [
      ['', ''], ['İ', 'i\u0307'], ['ΟΣ', 'ος'], ['ΟΣΑ', 'οσα'],
      ['Ο\u0301Σ', 'ο\u0301ς'], ['Σ', 'σ'], ['AΣ\u0301B', 'aσ\u0301b'],
      ['ÉCOLE 𐐀', 'école 𐐨'], ['\ua7ce', '\ua7ce'],
      ['A\ua7ceΣ', 'a\ua7ceσ'], ['ΑΣ\ua7ce', 'ας\ua7ce'],
      ...Array.from(unicode.upper, (character, index) => [character, lower[index]]),
    ];
    const entry = pathToFileURL(path.join(buildDirectory, 'dist/index.js')).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import { readFileSync } from 'node:fs';
      const { unicodeLowerV1 } = await import(${JSON.stringify(entry)});
      const inputs = JSON.parse(readFileSync(0, 'utf8'));
      process.stdout.write(JSON.stringify(inputs.map(unicodeLowerV1)));
    `], { input: JSON.stringify(cases.map(([input]) => input)), encoding: 'utf8', timeout: 10000 });
    expect(JSON.parse(output)).toEqual(cases.map(([, expected]) => expected));
  } finally {
    rmSync(buildDirectory, { recursive: true, force: true });
  }
}, 45000);
