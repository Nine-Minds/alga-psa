import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Native-Node regression check for the built artifacts.
 *
 * The workflow runtime is consumed by native Node (the server and the Temporal
 * worker), and `shared/tsup.config.ts` externalizes `@alga-psa/*` packages, so
 * every import it emits must resolve through real package exports — not through
 * Vitest/TypeScript aliases. This guards the bug where the runtime eagerly
 * imported `@alga-psa/billing/lib/quoteTermsContent`, which billing does not
 * export (ERR_PACKAGE_PATH_NOT_EXPORTED), preventing the built runtime from
 * loading. CI builds the workspace packages before these tests run.
 */

const repoRoot = path.resolve(__dirname, '../..');
const sharedDist = path.resolve(repoRoot, 'shared/dist');

function runNativeImport(specifier: string): { ok: boolean; output: string } {
  const script = `import(${JSON.stringify(specifier)}).then(() => console.log('OK')).catch((e) => { console.error(e.code || e.message); process.exit(1); })`;
  try {
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: stdout.includes('OK'), output: stdout };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}` };
  }
}

function collectJsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectJsFiles(full));
    } else if (entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

describe('quote terms shared runtime exports', () => {
  it('builds the workflow runtime with no eager import into a non-exported billing path', () => {
    const runtimeEntry = path.join(sharedDist, 'workflow/runtime/index.js');
    expect(existsSync(runtimeEntry), `Expected ${runtimeEntry}; build @alga-psa/shared first.`).toBe(true);

    for (const file of collectJsFiles(sharedDist)) {
      const contents = readFileSync(file, 'utf8');
      expect(
        contents.includes('@alga-psa/billing/lib/quoteTermsContent'),
        `${path.relative(repoRoot, file)} eager-imports a billing subpath that is not exported`,
      ).toBe(false);
    }
  });

  it('loads the full built workflow runtime natively without package-path errors', () => {
    const result = runNativeImport('@alga-psa/shared/workflow/runtime/index.js');
    expect(result.ok, result.output).toBe(true);
  });

  it('resolves the shared quote-terms module and its formatting dependency natively', () => {
    const terms = runNativeImport('@alga-psa/shared/lib/quoteTerms');
    expect(terms.ok, terms.output).toBe(true);

    const formatting = runNativeImport('@alga-psa/formatting/blocknoteUtils');
    expect(formatting.ok, formatting.output).toBe(true);

    const formattingRoot = runNativeImport('@alga-psa/formatting');
    expect(formattingRoot.ok, formattingRoot.output).toBe(true);
  });

  it('keeps the worker importing the shared module rather than into billing', () => {
    const dal = readFileSync(
      path.join(repoRoot, 'shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts'),
      'utf8',
    );
    expect(dal).not.toContain('@alga-psa/billing/lib/quoteTermsContent');
    expect(dal).toContain("from '../../../../lib/quoteTerms'");
  });
});
