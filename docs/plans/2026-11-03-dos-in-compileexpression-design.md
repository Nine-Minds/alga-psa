# Design — Security: dos in compileExpression

Card: Security: dos in compileExpression

## Finding (confirmed on main)

Expression validation bounds neither source size nor AST/sequence allocation (shared/workflow/runtime/expressionEngine.ts:40-51; validation/publishValidation.ts:211-237) and evaluation is synchronous with the 25 ms check only after it returns (:65-70), so `notContains([[1..10000000],...],'x')` allocates unbounded ranges before any limit is noticed.

## Approach

1. Enforce cost at parse time: cap source length, AST node count and range/sequence cardinality; reject `[a..b]` whose span exceeds a configured budget instead of materialising it.
2. Make evaluation interruptible: run the compiled expression under a worker/timeout boundary (or AST-walking budget) so the limit can abort mid-evaluation.
3. Tests: the `notContains` range bomb, deep nesting and long-chain expressions are refused fast; ordinary templates still compile and run.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
