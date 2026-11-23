import Handlebars from 'handlebars';

/**
 * The variables a Handlebars template reads: the first segment of every path
 * that is a value rather than a helper call (`{{company.name}}` is `company`,
 * `{{#if quoteReviewLink}}` is `quoteReviewLink`, `if` itself is not one).
 * `@data` and `this` references are not variables. A template that does not
 * parse reads nothing.
 */
export function templateVariables(source: string): Set<string> {
  const variables = new Set<string>();
  let ast: any;
  try {
    ast = Handlebars.parse(source);
  } catch {
    return variables;
  }

  const addPath = (path: any) => {
    if (path?.type === 'PathExpression' && !path.data && Array.isArray(path.parts) && path.parts.length > 0) {
      variables.add(path.parts[0]);
    }
  };

  const visitExpression = (node: any) => {
    if (!node) return;
    if (node.type === 'PathExpression') return addPath(node);
    if (node.type === 'SubExpression') return visitCall(node);
  };

  const visitCall = (node: any) => {
    const params: any[] = node.params ?? [];
    const pairs: any[] = node.hash?.pairs ?? [];
    // With arguments the path names a helper (if, each, formatDate); without,
    // it is a plain value or section.
    if (params.length === 0 && pairs.length === 0) addPath(node.path);
    params.forEach(visitExpression);
    pairs.forEach((pair) => visitExpression(pair.value));
  };

  const visitStatements = (statements: any[] | undefined) => (statements ?? []).forEach(visitStatement);

  const visitStatement = (node: any) => {
    if (!node) return;
    if (node.type === 'MustacheStatement') visitCall(node);
    else if (node.type === 'BlockStatement') {
      visitCall(node);
      visitStatements(node.program?.body);
      visitStatements(node.inverse?.body);
    }
  };

  visitStatements(ast.body);
  return variables;
}

/** Variables the reference template reads that the candidate does not, sorted. */
export function missingTemplateVariables(reference: string, candidate: string): string[] {
  const present = templateVariables(candidate);
  return [...templateVariables(reference)].filter((variable) => !present.has(variable)).sort();
}
