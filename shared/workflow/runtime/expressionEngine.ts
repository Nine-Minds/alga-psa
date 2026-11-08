import jsonata from 'jsonata';
import type { Expr } from './types';
import { WORKFLOW_EXPRESSION_FUNCTIONS, WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS } from './expressionFunctions';

const MAX_SOURCE_LENGTH = 8 * 1024;
const MAX_PARSE_DEPTH = 64;
const MAX_AST_NODES = 1_024;
const MAX_AST_DEPTH = 64;
const MAX_RUNTIME_DEPTH = 64;
const MAX_SEQUENCE_ITEMS = 4_096;
const MAX_RANGE_ITEMS = 4_096;
const MAX_TOTAL_RANGE_ITEMS = 4_096;
const MAX_EVALUATION_STEPS = 4_096;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_INPUT_NODES = 65_536;
const MAX_INTERMEDIATE_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const RANGE_FUNCTION = 'workflowBoundedRange';
const CONCAT_FUNCTION = 'workflowBoundedConcat';
const EVALUATE_ENTRY_HOOK = Symbol.for('jsonata.__evaluate_entry');
const EVALUATE_EXIT_HOOK = Symbol.for('jsonata.__evaluate_exit');

const allowedFunctions = new Set<string>(WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS);
const budgetsByEnvironment = new WeakMap<object, EvaluationBudget>();

type EvaluationBudget = {
  steps: number;
  rangeItems: number;
  intermediateBytes: number;
};

type AstNode = Record<string, unknown> & { type?: string; value?: unknown };
// JSONata 2.2 exposes the execution root internally, but its bundled types
// still describe the 1.7 API. Keep the runtime assertion at this boundary.
type JsonataEnvironment = jsonata.Environment;
type JsonataFocus = jsonata.Focus;

export type ExpressionContext = {
  payload?: unknown;
  vars?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: unknown;
  event?: unknown;
  [key: string]: unknown;
};

export type CompiledExpression = {
  evaluate: (ctx: ExpressionContext) => Promise<unknown>;
  source: string;
};

export async function evaluateExpressionSource(source: string, ctx: ExpressionContext): Promise<unknown> {
  const compiled = compileExpression({ $expr: source });
  return compiled.evaluate(ctx);
}

// jsonata parse errors are plain objects ({ code, position, message }), not Error instances.
export function describeExpressionError(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : null;
}

export function validateExpressionSource(source: string): void {
  parseAndInspectExpression(normalizeExpressionSource(source), false);
}

export function compileExpression(expr: Expr): CompiledExpression {
  const normalizedSource = normalizeExpressionSource(expr.$expr);
  const compiled = parseAndInspectExpression(normalizedSource, true);
  const compiledWithOptions = compiled as typeof compiled & {
    assign: (name: string | symbol, value: unknown) => void;
  };

  // JSONata invokes this hook at every AST evaluation entry. An instruction
  // counter is deterministic and preemptible in Temporal's workflow sandbox,
  // unlike a wall-clock race around synchronous expression execution.
  compiledWithOptions.assign(EVALUATE_ENTRY_HOOK, (_node: unknown, _input: unknown, environment: JsonataEnvironment) => {
    let budget = budgetsByEnvironment.get(getExecutionRoot(environment));
    if (!budget) {
      budget = { steps: 0, rangeItems: 0, intermediateBytes: 0 };
      budgetsByEnvironment.set(getExecutionRoot(environment), budget);
    }
    budget.steps += 1;
    if (budget.steps > MAX_EVALUATION_STEPS) {
      throw new Error(`Expression execution budget exceeded (${MAX_EVALUATION_STEPS} AST steps)`);
    }
  });

  // Bound expanded intermediate trees before the next native operator can
  // compare, coerce or clone them. Charging every occurrence also bounds the
  // guard's own traversal work, including shared subtrees.
  compiledWithOptions.assign(EVALUATE_EXIT_HOOK, (_node: unknown, _input: unknown, environment: JsonataEnvironment, result: unknown) => {
    reserveIntermediateBytes(getEvaluationBudget(environment), measureValueBytes(result, MAX_INTERMEDIATE_BYTES));
  });

  compiled.registerFunction(RANGE_FUNCTION, function (this: JsonataFocus, lhs: unknown, rhs: unknown) {
    const budget = getEvaluationBudget(this.environment);
    if (lhs === undefined || rhs === undefined || (typeof lhs === 'number' && typeof rhs === 'number' && lhs > rhs)) {
      return undefined;
    }
    if (typeof lhs !== 'number' || !Number.isInteger(lhs)) {
      throw new Error('The left side of the range operator (..) must evaluate to an integer');
    }
    if (typeof rhs !== 'number' || !Number.isInteger(rhs)) {
      throw new Error('The right side of the range operator (..) must evaluate to an integer');
    }

    const size = rhs - lhs + 1;
    if (!Number.isSafeInteger(size) || size > MAX_RANGE_ITEMS) {
      throw new Error(`Expression range exceeded max size (${MAX_RANGE_ITEMS} items)`);
    }
    if (budget.rangeItems + size > MAX_TOTAL_RANGE_ITEMS) {
      throw new Error(`Expression aggregate range budget exceeded (${MAX_TOTAL_RANGE_ITEMS} items)`);
    }
    reserveIntermediateBytes(budget, estimateBytes(size) + 64);
    budget.rangeItems += size;

    const sequence = new Array<number>(size) as number[] & { sequence?: boolean };
    for (let index = 0; index < size; index += 1) sequence[index] = lhs + index;
    sequence.sequence = true;
    return sequence;
  });

  compiled.registerFunction(CONCAT_FUNCTION, function (this: JsonataFocus, lhs: unknown, rhs: unknown) {
    const budget = getEvaluationBudget(this.environment);
    reserveIntermediateBytes(budget, measureValueBytes([lhs, rhs], MAX_INTERMEDIATE_BYTES));
    const left = lhs === undefined ? '' : jsonataString(lhs);
    const right = rhs === undefined ? '' : jsonataString(rhs);
    if (left.length + right.length > MAX_OUTPUT_BYTES) {
      throw new Error('Expression intermediate string exceeded max output size');
    }
    return left + right;
  });

  for (const definition of WORKFLOW_EXPRESSION_FUNCTIONS) {
    const implementation = definition.implementation as (...args: unknown[]) => unknown;
    compiled.registerFunction(definition.name, function (this: JsonataFocus, ...args: unknown[]) {
      const budget = getEvaluationBudget(this.environment);
      // Reserve before calling a helper that can copy, concatenate, or scan its
      // inputs. Input and AST limits bound the estimator itself.
      reserveIntermediateBytes(budget, measureValueBytes(args, MAX_INTERMEDIATE_BYTES));
      consumeEvaluationSteps(budget, measureValueNodes(args));
      const result = implementation(...args);
      reserveIntermediateBytes(budget, measureValueBytes(result, MAX_INTERMEDIATE_BYTES));
      return result;
    });
  }

  return {
    source: expr.$expr,
    evaluate: async (ctx: ExpressionContext) => {
      // Fail closed: the budget counters only fire if JSONata still invokes the
      // evaluate hooks and exposes the `base` frame. If that contract broke
      // (e.g. a jsonata upgrade), refuse to evaluate rather than run unbounded.
      await ensureBudgetHooksActive();
      measureValueBytes(ctx, MAX_INPUT_BYTES, MAX_INPUT_NODES);
      // Passing bindings creates a fresh JSONata execution frame. Its `base` is
      // inherited by every nested frame, so a cached compiled expression has
      // one budget per invocation, including concurrent invocations.
      const result = await compiled.evaluate(ctx, {});
      assertOutputWithinLimit(result);
      return result;
    }
  };
}

export function normalizeExpressionSource(source: string): string {
  // JSONata uses `=` / `!=` for equality checks; many authors intuitively write `==`.
  // Normalize `==` to `=` for compatibility with workflow fixtures and designer output.
  assertSourceWithinLimits(source);
  const normalized = source.replace(/==/g, '=');

  return normalized.replace(
    /(^|[^.$A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()/g,
    (match, prefix, name: string) => {
      if (!allowedFunctions.has(name)) {
        return match;
      }
      return `${prefix}$${name}`;
    }
  );
}

function parseAndInspectExpression(source: string, rewriteOperators: boolean): ReturnType<typeof jsonata> {
  assertSourceWithinLimits(source);
  const expression = jsonata(source, {
    stack: MAX_RUNTIME_DEPTH,
    sequence: MAX_SEQUENCE_ITEMS
  } as Parameters<typeof jsonata>[1]);
  const ast = expression.ast() as AstNode;
  inspectAst(ast, rewriteOperators);
  return expression;
}

function assertSourceWithinLimits(source: string): void {
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new Error(`Expression source exceeded max length (${MAX_SOURCE_LENGTH} characters)`);
  }

  const delimiters: string[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (const character of source) {
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      delimiters.push(character);
      if (delimiters.length > MAX_PARSE_DEPTH) {
        throw new Error(`Expression nesting exceeded max depth (${MAX_PARSE_DEPTH})`);
      }
    } else if (character === ')' || character === ']' || character === '}') {
      delimiters.pop();
    }
  }
}

function inspectAst(root: AstNode, rewriteOperators: boolean): void {
  const pending: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }];
  const seen = new WeakSet<object>();
  const astNodes: AstNode[] = [];
  let nodeCount = 0;
  let literalRangeItems = 0;

  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) pending.push({ node: item, depth });
      continue;
    }

    nodeCount += 1;
    if (nodeCount > MAX_AST_NODES) {
      throw new Error(`Expression AST exceeded max size (${MAX_AST_NODES} nodes)`);
    }
    if (depth > MAX_AST_DEPTH) {
      throw new Error(`Expression AST exceeded max depth (${MAX_AST_DEPTH})`);
    }

    const astNode = node as AstNode;
    astNodes.push(astNode);

    if (astNode.type === 'binary' && astNode.value === '..') {
      const lhs = astNode.lhs as AstNode | undefined;
      const rhs = astNode.rhs as AstNode | undefined;
      if (lhs?.type === 'number' && rhs?.type === 'number' && typeof lhs.value === 'number' && typeof rhs.value === 'number') {
        const size = lhs.value <= rhs.value ? rhs.value - lhs.value + 1 : 0;
        if (!Number.isSafeInteger(size) || size > MAX_RANGE_ITEMS) {
          throw new Error(`Expression range exceeded max size (${MAX_RANGE_ITEMS} items)`);
        }
        literalRangeItems += size;
        if (literalRangeItems > MAX_TOTAL_RANGE_ITEMS) {
          throw new Error(`Expression aggregate range budget exceeded (${MAX_TOTAL_RANGE_ITEMS} items)`);
        }
      }
    }

    for (const value of Object.values(astNode)) {
      if (value && typeof value === 'object') pending.push({ node: value, depth: depth + 1 });
    }
  }

  if (astNodes.some((node) => node.type === 'lambda' || (node.procedure as AstNode | undefined)?.type === 'lambda')) {
    throw new Error('Expression uses a function definition (lambda), which is not allowed');
  }
  for (const node of astNodes) validateAstFunctionNode(node);
  if (rewriteOperators) {
    for (const node of astNodes) {
      if (node.type === 'binary' && node.value === '..') rewriteBinaryAsFunction(node, RANGE_FUNCTION);
      else if (node.type === 'binary' && node.value === '&') rewriteBinaryAsFunction(node, CONCAT_FUNCTION);
    }
  }
}

function validateAstFunctionNode(astNode: AstNode): void {
  // Only the registered, budgeted implementations may occupy helper names.
  // Otherwise `$append := $eval` (or a path focus binding) bypasses every
  // restriction by evaluating new source in an unguarded interpreter.
  const bindingNames = [astNode.focus, astNode.index];
  if (astNode.type === 'bind') bindingNames.push((astNode.lhs as AstNode | undefined)?.value);
  for (const name of bindingNames) {
    if (typeof name === 'string' && (allowedFunctions.has(name) || name === RANGE_FUNCTION || name === CONCAT_FUNCTION)) {
      throw new Error(`Expression cannot rebind protected function: ${name}`);
    }
  }

  if (astNode.type === 'lambda') {
    throw new Error('Expression uses a function definition (lambda), which is not allowed');
  }

  if (astNode.type === 'function' || astNode.type === 'partial') {
    if ((astNode.procedure as AstNode | undefined)?.type === 'lambda') {
      throw new Error('Expression uses a function definition (lambda), which is not allowed');
    }
    const calleeName = getProcedureName(astNode.procedure);
    if (!calleeName) {
      throw new Error('Expression uses a dynamic or computed function call, which is not allowed');
    }
    assertAllowedFunction(calleeName);
    assertStaticProcedure(astNode.procedure);
  }

  if (astNode.type === 'apply') {
    const rhs = astNode.rhs as AstNode | undefined;
    const appliedName = getProcedureName(astNode.rhs);
    if (appliedName) {
      assertAllowedFunction(appliedName);
      assertStaticProcedure(astNode.rhs);
    } else if (!rhs || (rhs.type !== 'function' && rhs.type !== 'partial' && rhs.type !== 'lambda')) {
      throw new Error('Expression applies (~>) a value that cannot be validated against the function allowlist');
    }
  }
}

function assertStaticProcedure(procedure: unknown): void {
  const node = procedure as AstNode | undefined;
  if (node?.type === 'variable') return;
  if (node?.type === 'block' && Array.isArray(node.expressions) && node.expressions.length === 1) {
    return assertStaticProcedure(node.expressions[0]);
  }
  throw new Error('Expression uses a dynamic or computed function call, which is not allowed');
}

function assertAllowedFunction(name: string): void {
  const normalizedName = name.startsWith('$') ? name.slice(1) : name;
  if (!allowedFunctions.has(normalizedName)) {
    throw new Error(`Expression uses disallowed function: ${normalizedName}`);
  }
}

function rewriteBinaryAsFunction(node: AstNode, name: string): void {
  const lhs = node.lhs;
  const rhs = node.rhs;
  node.type = 'function';
  node.value = '(';
  node.procedure = { type: 'variable', value: name, position: node.position };
  node.arguments = [lhs as AstNode, rhs as AstNode];
  delete node.lhs;
  delete node.rhs;
}

function getProcedureName(procedure: unknown): string | null {
  if (!procedure || typeof procedure !== 'object' || Array.isArray(procedure)) return null;
  const node = procedure as AstNode;
  if ((node.type === 'variable' || node.type === 'name') && typeof node.value === 'string') return node.value;
  if (node.type === 'path' && Array.isArray(node.steps)) {
    for (let index = node.steps.length - 1; index >= 0; index -= 1) {
      const name = getProcedureName(node.steps[index]);
      if (name) return name;
    }
  }
  if (node.type === 'block' && Array.isArray(node.expressions) && node.expressions.length === 1) {
    return getProcedureName(node.expressions[0]);
  }
  return null;
}

function getExecutionRoot(environment: JsonataEnvironment): object {
  const root = (environment as JsonataEnvironment & { base?: object }).base;
  if (!root || typeof root !== 'object') throw new Error('JSONata execution budget support is unavailable');
  return root;
}

function hasExecutionRoot(environment: JsonataEnvironment): boolean {
  const root = (environment as JsonataEnvironment & { base?: object }).base;
  return Boolean(root) && typeof root === 'object';
}

// The entire DoS defense rests on two JSONata internals: that it invokes the
// EVALUATE_ENTRY_HOOK / EVALUATE_EXIT_HOOK symbols on every node, and that it
// exposes a stable `base` execution frame (getExecutionRoot) the per-invocation
// budget is keyed on. A jsonata upgrade that renamed those symbols or
// restructured frames would leave the counters silent — the original unbounded
// DoS, but with a green test suite. Verify that contract against a trivial probe
// and fail closed if it ever stops holding. The probe is pure (`1 + 1`, no I/O,
// clock, or randomness), so it is safe to run inside Temporal's deterministic
// workflow sandbox.
export async function verifyBudgetHooksActive(jsonataFactory: typeof jsonata = jsonata): Promise<void> {
  const probe = jsonataFactory('1 + 1') as ReturnType<typeof jsonata> & {
    assign: (name: string | symbol, value: unknown) => void;
  };
  let entryFrameResolved = false;
  let exitFrameResolved = false;
  probe.assign(EVALUATE_ENTRY_HOOK, (_node: unknown, _input: unknown, environment: JsonataEnvironment) => {
    if (hasExecutionRoot(environment)) entryFrameResolved = true;
  });
  probe.assign(EVALUATE_EXIT_HOOK, (_node: unknown, _input: unknown, environment: JsonataEnvironment) => {
    if (hasExecutionRoot(environment)) exitFrameResolved = true;
  });

  const result = await probe.evaluate({});
  if (result !== 2 || !entryFrameResolved || !exitFrameResolved) {
    throw new Error(
      'Expression budget enforcement is inactive: the JSONata evaluate-hook contract changed ' +
        '(entry/exit hook or base execution frame). Refusing to evaluate workflow expressions until it is restored.'
    );
  }
}

let budgetHookVerification: Promise<void> | null = null;

// Run the self-check once per process and reuse the result. A rejection is
// sticky on purpose: if the contract is broken, every evaluation stays refused.
function ensureBudgetHooksActive(): Promise<void> {
  if (!budgetHookVerification) {
    budgetHookVerification = verifyBudgetHooksActive();
  }
  return budgetHookVerification;
}

function getEvaluationBudget(environment: JsonataEnvironment): EvaluationBudget {
  const budget = budgetsByEnvironment.get(getExecutionRoot(environment));
  if (!budget) throw new Error('Expression evaluation budget was not initialized');
  return budget;
}

function reserveIntermediateBytes(budget: EvaluationBudget, bytes: number): void {
  budget.intermediateBytes += bytes;
  if (budget.intermediateBytes > MAX_INTERMEDIATE_BYTES) {
    throw new Error(`Expression allocation budget exceeded (${MAX_INTERMEDIATE_BYTES} bytes)`);
  }
}

function consumeEvaluationSteps(budget: EvaluationBudget, steps: number): void {
  budget.steps += steps;
  if (budget.steps > MAX_EVALUATION_STEPS) {
    throw new Error(`Expression execution budget exceeded (${MAX_EVALUATION_STEPS} AST and helper steps)`);
  }
}

/** Visit each occurrence, not each identity: aliases can expand during coercion
 * or JSON serialization. Ancestor tracking rejects cycles without rejecting DAGs.
 * Recursion is bounded before descending; no array of all pending children is built.
 */
function walkValueTree(
  root: unknown,
  visit: (value: unknown, key: string | undefined, hasPrevious: boolean) => void,
  maxNodes = MAX_INPUT_NODES
): number {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  const walk = (value: unknown, depth: number, key?: string, hasPrevious = false): void => {
    if (++nodes > maxNodes) throw new Error(`Expression value exceeded max size (${maxNodes} values)`);
    if (depth > MAX_PARSE_DEPTH) throw new Error(`Expression value exceeded max depth (${MAX_PARSE_DEPTH})`);
    visit(value, key, hasPrevious);
    if (!value || typeof value !== 'object' || value instanceof Date) return;
    if (ancestors.has(value)) throw new Error('Expression result is not JSON-serializable (cyclic value)');
    ancestors.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) walk(value[index], depth + 1, undefined, index > 0);
    } else {
      let hasPrevious = false;
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        walk((value as Record<string, unknown>)[key], depth + 1, key, hasPrevious);
        hasPrevious = true;
      }
    }
    ancestors.delete(value);
  };
  walk(root, 0);
  return nodes;
}

function measureValueNodes(value: unknown): number {
  return walkValueTree(value, () => {}, MAX_INPUT_NODES);
}

function estimateBytes(value: number): number {
  return value * 8;
}

function measureValueBytes(value: unknown, maxBytes: number, maxNodes = MAX_INPUT_NODES): number {
  let bytes = 0;
  walkValueTree(value, (current, key) => {
    // Charge a slot even for empty strings/containers, so repeated traversal
    // cannot do unaccounted work on values with no string content.
    bytes += 8;
    if (key !== undefined) bytes += key.length * 2;
    if (typeof current === 'string') bytes += current.length * 2;
    else if (typeof current === 'number') bytes += 8;
    else if (typeof current === 'boolean') bytes += 4;
    else if (current instanceof Date) bytes += 16;
    else if (Array.isArray(current)) bytes += 16;
    else if (current && typeof current === 'object') bytes += 32;
    else bytes += 8;
    if (bytes > maxBytes) throw new Error(`Expression input exceeded max size (${maxBytes} bytes)`);
  }, maxNodes);
  return bytes;
}

function jsonataString(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  assertOutputWithinLimit(value);
  return JSON.stringify(value) ?? '';
}

function assertOutputWithinLimit(root: unknown): void {
  let length = 0;
  walkValueTree(root, (value, key, hasPrevious) => {
    if (hasPrevious) length += 1;
    if (key !== undefined) length += jsonEscapedLength(key) + 1;
    if (typeof value === 'string') length += jsonEscapedLength(value);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      length += JSON.stringify(value).length;
    } else if (value instanceof Date) {
      length += JSON.stringify(value).length;
    } else if (value && typeof value === 'object') {
      length += 2;
    } else {
      throw new Error('Expression result is not JSON-serializable');
    }
    if (length > MAX_OUTPUT_BYTES) throw new Error('Expression result exceeded max output size');
  });
}

function jsonEscapedLength(value: string): number {
  let length = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || [8, 9, 10, 12, 13].includes(code)) length += 2;
    else if (code <= 0x1f) length += 6;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      length += 2;
      index += 1;
    } else length += code >= 0xd800 && code <= 0xdfff ? 6 : 1;
    if (length > MAX_OUTPUT_BYTES) return length;
  }
  return length;
}
