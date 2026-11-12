import ts from 'typescript';

export interface SourceBoundaryRule {
  name: string;
  regex: RegExp;
}

/** Only expressions that cannot execute code or read mutable state are metadata. */
function isLiteralData(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
    return isLiteralData(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(node)) {
    return (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken)
      && ts.isNumericLiteral(node.operand);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isLiteralData);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(property => ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name)
      && isLiteralData(property.initializer));
  }
  return false;
}

/**
 * Check a source boundary while permitting named, top-level const declarations
 * of inert metadata. Only their literal initializers are masked; imports, calls,
 * getters, spreads and surrounding code still pass through every rule. This
 * avoids turning a metadata exception into a whole-file runtime-code exception.
 */
export function findSourceBoundaryViolations(
  source: string,
  rules: readonly SourceBoundaryRule[],
  literalDeclarations: readonly string[] = [],
): string[] {
  let checkedSource = source;
  if (literalDeclarations.length) {
    const file = ts.createSourceFile('boundary.ts', source, ts.ScriptTarget.Latest, true);
    const ranges: Array<{ start: number; end: number }> = [];
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)
        || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && literalDeclarations.includes(declaration.name.text)
          && declaration.initializer && isLiteralData(declaration.initializer)) {
          ranges.push({ start: declaration.initializer.getStart(file), end: declaration.initializer.end });
        }
      }
    }
    // Reverse order preserves offsets for declarations earlier in the file.
    for (const { start, end } of ranges.reverse()) {
      checkedSource = checkedSource.slice(0, start)
        + checkedSource.slice(start, end).replace(/[^\r\n]/g, ' ')
        + checkedSource.slice(end);
    }
  }
  return rules.filter(rule => {
    rule.regex.lastIndex = 0;
    return rule.regex.test(checkedSource);
  }).map(rule => rule.name);
}
