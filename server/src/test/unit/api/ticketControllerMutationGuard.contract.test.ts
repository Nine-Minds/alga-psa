import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guard: any ApiTicketController handler that performs a non-GET operation must authorize
 * with assertTicketMutationAllowed, never assertTicketReadAllowed (bundle rules match on
 * action, so a read check lets update/delete-excluded tickets be mutated).
 * Handlers are classified by name; read handlers must be listed explicitly.
 */
const READ_HANDLERS = new Set([
  'getById', 'getComments', 'getChecklist', 'getExternalLinks', 'findByExternalLink',
  'getDocuments', 'getAssets', 'getAgents', 'getWatchers', 'downloadDocument',
  'downloadDocumentVariant', 'getTimeEntries', 'getMaterials',
]);

function callsByHandler(): Map<string, Set<string>> {
  const file = path.resolve(__dirname, '../../../lib/api/controllers/ApiTicketController.ts');
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result = new Map<string, Set<string>>();
  const visit = (node: ts.Node, current?: string) => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) current = node.name.text;
    if (
      current &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const name = node.expression.name.text;
      if (name === 'assertTicketReadAllowed' || name === 'assertTicketMutationAllowed') {
        if (!result.has(current)) result.set(current, new Set());
        result.get(current)!.add(name);
      }
    }
    ts.forEachChild(node, (c) => visit(c, current));
  };
  visit(sf);
  return result;
}

describe('ApiTicketController mutation authorization guard', () => {
  const calls = callsByHandler();

  it('no non-read handler calls assertTicketReadAllowed', () => {
    const offenders = [...calls.entries()]
      .filter(([name, used]) => !READ_HANDLERS.has(name) && used.has('assertTicketReadAllowed'))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it('read handlers never use the mutation assertion; mutation handlers do', () => {
    for (const [name, used] of calls) {
      if (name === 'assertTicketMutationAllowed' || name === 'assertTicketReadAllowed') continue;
      if (READ_HANDLERS.has(name)) expect(used.has('assertTicketMutationAllowed'), name).toBe(false);
      else expect(used.has('assertTicketMutationAllowed'), name).toBe(true);
    }
    expect(calls.has('update')).toBe(true);
    expect(calls.has('delete')).toBe(true);
  });
});
