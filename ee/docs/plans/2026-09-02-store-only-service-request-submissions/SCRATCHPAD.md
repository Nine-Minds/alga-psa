# Scratchpad — Store-only service request submissions

- Plan slug: `store-only-service-request-submissions`
- Created: `2026-09-02`

## Decisions

- 2026-09-02: Reuse the existing execution-provider seam and `service_request_submissions`; do not add a second questionnaire store or synthetic ticket.
- 2026-09-02: Model store-only as a successful no-downstream-execution provider so common persistence/history/search behavior remains intact.
- 2026-09-02: Keep ticket-only as the default for backward compatibility.
- 2026-09-02: Add a durable client submission key because existing code has no submission-level idempotency mechanism and the card explicitly requires retry/duplicate safety.

## Discoveries / Constraints

- 2026-09-02: `submissionService.ts` persists the submission before resolving and invoking the execution provider.
- 2026-09-02: Built-in providers are registered in `providers/registry.ts`; only `ticket-only` is currently registered in core.
- 2026-09-02: Definition validation/editor options already derive from registered provider metadata.
- 2026-09-02: MSP definition history and client portal My Requests already retrieve full submission records through `submissionHistory.ts`.
- 2026-09-02: The follow-on structured account/asset mapping card must consume immutable raw submissions but is not in this scope.

## Commands / Runbooks

- 2026-09-02: Focused discovery used `rg` over `server/src/lib/service-requests`, the MSP definition editor, client portal request-service pages, migrations, and integration tests.
- 2026-09-02: Validate migrations with the repository integration bootstrap and run service-request lifecycle, ticket execution, portal history, and new idempotency/store-only behavioral tests.

## Links / References

- `docs/plans/2026-09-02-store-only-service-request-submissions-plan.md`
- `server/src/lib/service-requests/submissionService.ts`
- `server/src/lib/service-requests/providers/registry.ts`
- `server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts`
- `server/src/lib/service-requests/definitionValidation.ts`
- `server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx`
- `server/src/lib/service-requests/submissionHistory.ts`

## Open Questions

- None blocking; implementation may refine the exact migration/index name to match repository conventions.
