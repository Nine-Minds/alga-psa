import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('authorization kernel subpaths expose checked types to consumers without path aliases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authorization-consumer-'));
  try {
    fs.symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), path.join(dir, 'node_modules'), 'dir');
    const file = path.join(dir, 'consumer.mts');
    fs.writeFileSync(file, `
      import { matchRulesForAction } from '@alga-psa/authorization/kernel/actionAliases';
      import { registerBuiltinRuleResolver } from '@alga-psa/authorization/kernel/builtinRuleResolvers';
      import type { AuthorizationSubject } from '@alga-psa/authorization/kernel/contracts';

      matchRulesForAction([], 'ticket', 'read');
      registerBuiltinRuleResolver({ id: 'consumer', appliesTo: () => true, resolveRules: () => [] });
      // These must be type errors, not calls silently accepted through an any export.
      // @ts-expect-error actions cannot be numbers
      matchRulesForAction([], 'ticket', 123);
      // @ts-expect-error a resolver must satisfy the resolver contract
      registerBuiltinRuleResolver(123);
      // @ts-expect-error a subject must satisfy the subject contract
      const subject: AuthorizationSubject = 123;
    `);
    const program = ts.createProgram([file], {
      noEmit: true,
      strict: true,
      allowJs: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    });
    const source = program.getSourceFile(file);
    assert.ok(source);
    const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
    assert.deepEqual(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
