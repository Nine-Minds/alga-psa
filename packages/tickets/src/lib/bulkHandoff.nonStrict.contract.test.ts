// @vitest-environment node
/**
 * The bulk handoff helpers are compiled by every app that imports @alga-psa/tickets, and the EE server compiles them
 * with `strict: false`. Without strictNullChecks, truthiness on the `ok` discriminant (`if (result.ok)`) does not
 * narrow the result union, so code that reads a refusal's `message` after such a check type-checks here but breaks
 * the EE build. This compiles the module under the EE server's non-strict settings as well as strict ones.
 */
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const modules = ['bulkHandoff.ts'].map((file) => path.join(__dirname, file));

function diagnostics(options: ts.CompilerOptions): string[] {
  const program = ts.createProgram(modules, {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...options,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('bulk handoff helpers compile in every consuming app', () => {
  it('type-checks with strict: false (EE server settings)', () => {
    expect(diagnostics({ strict: false })).toEqual([]);
  });

  it('type-checks with strict: true', () => {
    expect(diagnostics({ strict: true })).toEqual([]);
  });
});
