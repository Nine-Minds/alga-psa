# Plan: concurrency/quota layer for workflow expression evaluation

Card: 227af5c0. Follow-up to `c46829b6` (DoS in compileExpression); parent guard commit `e1337ae99a`.

## Gap
Budgets are per invocation (steps, range, intermediate bytes). N concurrent legal-but-expensive evaluations exhaust
heap; the per-tenant request limiter does not constrain a single evaluation.

## Change set (in order)
1. **Inventory + funnel.** Grep every evaluation entry point (`compileExpression` / `evaluate` / `jsonata`) under
   `ee/packages/workflows/src` and `packages/`, and route all of them through one `evaluateWorkflowExpression()` wrapper.
2. **Process-wide weighted semaphore** in the wrapper: `WORKFLOW_EVAL_MAX_CONCURRENCY` (default 4–8), bounded wait queue
   with `WORKFLOW_EVAL_QUEUE_TIMEOUT_MS` (default 2000) → typed `EvaluationBusyError` → 429 + `Retry-After` at the API
   boundary, fail-closed for internal callers. Release in `finally`; nested evaluations inherit the held slot (reentrant).
3. **Per-request deadline** threaded into the existing budget hook: `cpuBudgetMs` (~250) / `wallBudgetMs` (~2 s) plus an
   `AbortSignal`. Cooperative checks at step/loop boundaries + await points; exceed ⇒ `EvaluationBudgetExceededError`
   (same visible behaviour as the step/byte budgets). Wall ceiling aborts and frees the slot.
4. **API-layer rate limits** on simulate/draft (`ee/packages/workflows` draft simulation, `simulator.ts`): per-tenant and
   per-user token buckets applied **before** acquiring a slot; reuse the existing limiter mechanism.
5. **Metrics**: queue depth, wait time, active slots, busy rejections, deadline exceeded, rate-limit hits, one structured
   line per rejection.

## Not doing
Out-of-process isolate boundary (out of scope for this card). No language/semantics change. No replacement of the global
request limiter. No new worker tier.

## Do not regress
Parent's fail-closed JSONata hook guard must keep firing: admission is additive. Regression test asserts the guard still
throws when its hook is unregistered, and a looping expression still terminates through the step budget.

## Risks
Nested-evaluation deadlock (reentrant token + slot accounting assertions); too-low default starving batch runs (env knob +
clear 429); rate limit placed inside admission would burn slots (keep it before); cooperative deadline is not a hard CPU kill.
