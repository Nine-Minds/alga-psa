import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// This is a SQL-writer inventory, not a source spelling assertion. Behavioral coverage for
// these writers lives in quoteLifecycle.integration.test.ts. A new writer requires a decision.
const root = path.resolve(__dirname, '../../..');
const decisions: Record<string, string> = {
  'shared/lib/quotes/quoteLifecycleEvents.ts':
    'shared transition engine; tested commit/rollback, conversion/reversion and supersession',
  'packages/billing/src/models/quote.ts':
    'model mutation and expire-on-read; tested against real Postgres',
  'shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts':
    'worker mutation and expire-on-read; tested against real Postgres',
  'server/src/lib/jobs/handlers/expireQuotesHandler.ts':
    'scheduled expiry; raced with both readers against real Postgres',
  'packages/billing/src/actions/invoiceModification.ts':
    'non-transition invoice unlink writes no status after delegation to system-only seam',
};
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (
      /^(node_modules|dist|test|tests|__tests__|migrations|\.next.*)$/.test(
        entry.name
      )
    )
      return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? files(full)
      : /(?<!\.test)(?<!\.spec)(?<!\.d)\.tsx?$/.test(entry.name)
        ? [full]
        : [];
  });
}
function writesStatus(node: ts.Node): boolean {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'update'
  )
    return false;
  const arg = node.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  let status = false;
  const properties = (n: ts.Node) => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText().replace(/['"]/g, '') === 'status'
    )
      status = true;
    ts.forEachChild(n, properties);
  };
  properties(arg);
  if (!status) return false;
  let quoteTable = false;
  const receiver = (n: ts.Node) => {
    if (ts.isStringLiteral(n) && /^(?:quotes)(?:\s|$)/.test(n.text))
      quoteTable = true;
    ts.forEachChild(n, receiver);
  };
  receiver(node.expression.expression);
  return quoteTable;
}
describe('quote status writer inventory', () => {
  it('classifies every direct quote status update across product source trees', () => {
    const writers = new Set<string>();
    for (const base of ['packages', 'shared', 'server/src', 'ee/server/src']) {
      for (const file of files(path.join(root, base))) {
        const content = readFileSync(file, 'utf8');
        // Only parse candidates; the AST below still decides whether they write quote status.
        if (!content.includes('quotes') || !content.includes('update')) continue;
        const source = ts.createSourceFile(
          file,
          content,
          ts.ScriptTarget.Latest,
          true
        );
        const visit = (node: ts.Node) => {
          if (writesStatus(node)) writers.add(path.relative(root, file));
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
    expect([...writers].filter((writer) => !decisions[writer])).toEqual([]);
    expect(writers.size).toBeGreaterThan(0);
  });
});
