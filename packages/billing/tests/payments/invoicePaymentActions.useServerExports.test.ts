// @vitest-environment node

/**
 * Next refuses every non-async runtime export from a 'use server' module
 * ("a 'use server' file can only export async functions") and fails the build
 * of every route importing it — the whole Invoicing page 500s, and a client
 * that imports such an export receives an action proxy instead of the value.
 * That is exactly how the manual payment method list broke the Finalized tab,
 * so the action module this card added is parsed and checked here. Types and
 * interfaces are erased, so they are allowed.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ACTIONS_FILE = path.resolve(__dirname, '../../src/actions/invoicePaymentActions.ts');

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind));

const isAsyncFn = (node: ts.Node | undefined): boolean =>
  Boolean(node)
  && (((ts.isFunctionDeclaration(node!) || ts.isFunctionExpression(node!) || ts.isArrowFunction(node!))
      && hasModifier(node!, ts.SyntaxKind.AsyncKeyword))
    || (ts.isVariableDeclaration(node!) && isAsyncFn(node!.initializer))
    || (ts.isParenthesizedExpression(node!) && isAsyncFn(node!.expression))
    || (ts.isAsExpression(node!) && isAsyncFn(node!.expression))
    // withAuth(async (...) => ...) and friends yield an async action.
    || (ts.isCallExpression(node!) && node!.arguments.some((arg) => isAsyncFn(arg))));

function nonAsyncRuntimeExports(source: ts.SourceFile): string[] {
  const bad: string[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (!hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) bad.push(statement.name?.text ?? 'default');
    } else if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!isAsyncFn(declaration)) bad.push(declaration.name.getText(source));
      }
    } else if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement))
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      bad.push(statement.name?.text ?? 'default');
    } else if (ts.isExportAssignment(statement)) {
      bad.push('default');
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      // A value re-export is registered as a server reference too; an imported
      // type re-exported this way even throws at dev runtime.
      bad.push(statement.getText(source));
    }
  }
  return bad;
}

describe('invoicePaymentActions is a valid "use server" module', () => {
  const source = ts.createSourceFile(
    ACTIONS_FILE,
    fs.readFileSync(ACTIONS_FILE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  it('is marked "use server"', () => {
    const first = source.statements[0];
    expect(
      Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)
        && first.expression.text === 'use server'),
    ).toBe(true);
  });

  it('exports only async functions at runtime', () => {
    expect(nonAsyncRuntimeExports(source)).toEqual([]);
  });
});
