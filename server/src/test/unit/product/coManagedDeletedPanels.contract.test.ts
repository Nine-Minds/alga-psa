import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Native-ticket plan T013: a retired panel must not retain a production caller.
const root = path.resolve(__dirname, '../../../../..');
const retired = new Set([
  'CoManagedTicketPanel',
  'CoManagedTicketEditor',
  'CoManagedTicketConversation',
  'CoManagedTicketAssignment',
]);

function retiredImports(text: string) {
  const source = ts.createSourceFile('screen.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  function inspect(node: ts.Node) {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const basename = path.posix.basename(specifier.text).replace(/\.[cm]?[jt]sx?$/, '');
      if (retired.has(basename)) found.push(specifier.text);
    }
    if (ts.isImportSpecifier(node) && retired.has((node.propertyName ?? node.name).text)) {
      found.push((node.propertyName ?? node.name).text);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  return found;
}

function productionSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return /^(node_modules|dist|test|__tests__|\.next.*)$/.test(entry.name) ? [] : productionSources(full);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [full] : [];
  });
}

it('finds static, barrel, dynamic and CommonJS references without treating comments as callers', () => {
  expect(retiredImports(`
    import Panel from './CoManagedTicketPanel';
    export { default } from './CoManagedTicketEditor';
    import { CoManagedTicketConversation as Conversation } from './barrel';
    const Assignment = import('./CoManagedTicketAssignment');
    const Legacy = require('./CoManagedTicketPanel.tsx');
    // import Panel from './CoManagedTicketPanel';
  `)).toHaveLength(5);
});

it('has no production import or re-export of any retired stacked ticket panel', () => {
  const findings = [path.join(root, 'server/src'), path.join(root, 'packages')]
    .flatMap(productionSources)
    .flatMap(file => retiredImports(fs.readFileSync(file, 'utf8')).map(specifier => ({ file: path.relative(root, file), specifier })));
  expect(findings).toEqual([]);
});
