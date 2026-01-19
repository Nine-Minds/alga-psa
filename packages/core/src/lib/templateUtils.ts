import P from 'parsimmon';

// Forward declarations for recursive parsers
const Expression: P.Parser<any> = P.lazy((): P.Parser<any> => P.alt(OrExpressionParser, TermParser));
const TermParser: P.Parser<any> = P.lazy((): P.Parser<any> => P.alt(DateMethodCallParser, DateConstructorParser, VariableParser, StringLiteralParser));

const StringLiteralParser = P.alt(
  P.regexp(/'((?:\\.|[^'])*)'/s, 1),
  P.regexp(/"((?:\\.|[^"])*)"/s, 1)
).map((value) => ({ type: 'LiteralString', value }));

const VariableParser = P.regexp(/[a-zA-Z_][a-zA-Z0-9_.]*/).map((name) => ({ type: 'Variable', name }));

const DateConstructorParser = P.seqMap(
  P.string('new').then(P.whitespace),
  P.string('Date').then(P.optWhitespace),
  P.string('(').then(P.optWhitespace),
  P.alt(VariableParser, StringLiteralParser),
  P.optWhitespace.then(P.string(')')),
  (_newDateStrAndWs, _dateStrAndWs, _openParenAndWs, arg, _closeParenAndWs) => ({ type: 'DateConstructor', argument: arg })
);

const DateMethodCallParser = P.seqMap(
  P.alt(DateConstructorParser, VariableParser),
  P.string('.'),
  P.alt(P.string('toLocaleDateString'), P.string('toLocaleString')),
  P.string('(').then(P.optWhitespace).then(P.string(')')),
  (obj, _dot, methodName, _parens) => ({
    type: 'MethodCall',
    object: obj,
    methodName: methodName as 'toLocaleDateString' | 'toLocaleString',
    arguments: []
  })
);

const OrExpressionParser = P.seqMap(
  TermParser,
  P.optWhitespace.then(P.string('||')).then(P.optWhitespace),
  Expression,
  (left, _op, right) => ({ type: 'Or', left, right })
);

const ExpressionContentParser = Expression;

const TemplateExpressionParser = ExpressionContentParser.wrap(P.string('${'), P.string('}'))
  .map((expr) => ({ type: 'TemplateExpression', expression: expr }));

// Robust LiteralTextParser to handle '$' not followed by '{'
const NonDollarChar = P.regexp(/[^$]/);
const DollarNotFollowedByBrace = P.string('$').notFollowedBy(P.string('{'));

const LiteralTextParser = P.alt(
  DollarNotFollowedByBrace,
  NonDollarChar
).atLeast(1).tie().map((text) => ({ type: 'LiteralText', value: text }));

const MainTemplateParser = P.alt(TemplateExpressionParser, LiteralTextParser).many();

function safeGet(obj: any, path: string): any {
  if (!path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function evaluateAstNode(node: any, contextData: Record<string, any>): any {
  if (!node) return undefined;

  switch (node.type) {
    case 'LiteralString':
      return node.value;
    case 'Variable': {
      const varPath = node.name.startsWith('contextData.') ? node.name.substring('contextData.'.length) : node.name;
      return safeGet(contextData, varPath);
    }
    case 'Or': {
      const leftValue = evaluateAstNode(node.left, contextData);
      if (leftValue) {
        return leftValue;
      }
      return evaluateAstNode(node.right, contextData);
    }
    case 'DateConstructor': {
      const dateArgValue = evaluateAstNode(node.argument, contextData);
      if (dateArgValue === undefined || dateArgValue === null || dateArgValue === '') {
        console.warn("Templating: Invalid or missing argument for new Date():", dateArgValue);
        return new Date(NaN);
      }
      try {
        return new Date(dateArgValue);
      } catch (e) {
        console.error("Templating: Error creating Date from argument:", dateArgValue, e);
        return new Date(NaN);
      }
    }
    case 'MethodCall': {
      const objectValue = evaluateAstNode(node.object, contextData);
      if (!(objectValue instanceof Date) || isNaN(objectValue.getTime())) {
        console.warn(`Templating: Cannot call method '${node.methodName}' on invalid or non-Date object:`, objectValue);
        return undefined;
      }
      if (node.methodName === 'toLocaleDateString') {
        return objectValue.toLocaleDateString();
      } else if (node.methodName === 'toLocaleString') {
        return objectValue.toLocaleString();
      }
      console.warn(`Templating: Unsupported method call: ${node.methodName} on Date object.`);
      return undefined;
    }
    default:
      console.warn('Templating: Unknown AST node type during evaluation:', node.type, node);
      return undefined;
  }
}

function evaluateParsedTemplate(parsedNodes: any[], contextData: Record<string, any>): string {
  return parsedNodes.map((node) => {
    if (node.type === 'TemplateExpression') {
      const evaluated = evaluateAstNode(node.expression, contextData);
      return (evaluated === undefined || evaluated === null) ? '' : String(evaluated);
    } else if (node.type === 'LiteralText') {
      return node.value;
    }
    console.warn('Templating: Unknown node type in parsed template array:', node.type, node);
    return '';
  }).join('');
}

export const processTemplateVariables = (value: any, contextData: Record<string, any> | undefined | null): any => {
  if (typeof value === 'string') {
    if (!value.includes('${')) {
      return value;
    }
    const currentContextData = contextData || {};

    try {
      const parseResult = MainTemplateParser.parse(value);
      if (parseResult.status) {
        return evaluateParsedTemplate(parseResult.value, currentContextData);
      } else {
        console.warn('Templating: Parsing failed for string:', value, P.formatError(value, parseResult));
        return value;
      }
    } catch (e) {
      console.error('Templating: Error processing template string:', value, e);
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => processTemplateVariables(item, contextData));
  }

  if (typeof value === 'object' && value !== null) {
    const processedObject: Record<string, any> = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        processedObject[key] = processTemplateVariables((value as any)[key], contextData);
      }
    }
    return processedObject;
  }

  return value;
};

