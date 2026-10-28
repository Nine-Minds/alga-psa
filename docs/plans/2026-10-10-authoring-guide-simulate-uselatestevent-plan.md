# Authoring guide: simulate with useLatestEvent, plus a publish-time replay warning

Card: alga0002106 follow-up. Branch: `feature/alga0002106-authoring-guide-simulate-with-uselat`.

## Problem

Commit `2a65ebca79` (already on this branch) let `POST /api/workflow-definitions/simulate` replay a stored
`workflow_runtime_events` row (`eventId`, or `useLatestEvent: true`). It also fails the simulation with
"Production would skip this event…" when the replay would not launch in production, and adds a warning when the
payload was synthesized. None of the author-facing text mentions replay, so an author (human or MCP agent) who
follows the documented loop still simulates against a synthesized payload:

| Surface | Location | Current text |
|---|---|---|
| Authoring guide, verify step | `shared/workflow/runtime/designer/authoringGuide.ts:136` | "simulate with a realistic payload" |
| Authoring guide, pitfall | `shared/workflow/runtime/designer/authoringGuide.ts:305` | "Validate, then simulate, before saving…" |
| API registry, workflow-creation playbook step 7 | `ee/docs/api-registry/workflows.json:11` | "simulate with a realistic payload" |
| API registry, simulate route description and playbook | `ee/docs/api-registry/workflows.json:66-74` | "Omit payload to have one synthesized…" / "simulate with a payload representative of the user's request" |
| OpenAPI simulate body | `server/src/lib/api/openapi/routes/unversionedPublicV1.ts:138-149` | `eventId` / `useLatestEvent` are not documented |

The MCP agent reads all of these surfaces (it gets the guide from `GET /api/workflow/registry/authoring-guide`, and
the playbooks and OpenAPI through `search_api_registry`). Fixing only `authoringGuide.ts` would leave the playbook
contradicting it, so the scope covers all of them.

## How replay relates to static validation (grounding for the publish warning)

- `computeValidation` (`workflow-runtime-v2-actions.ts` ~L890-935) already **blocks** publish with
  `TRIGGER_MAPPING_REQUIRED` when the *current catalog's* source schema ref (`trigger.sourcePayloadSchemaRef ??
  event_catalog.payload_schema_ref`) differs from `definition.payloadSchemaRef` and there is no mapping.
- The event stream worker (`services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts` L378-445)
  checks each event against the `payload_schema_ref` **stamped on the event at ingest**
  (`trigger.sourcePayloadSchemaRef ?? event.payload_schema_ref`). It skips a workflow when:
  (a) no source ref is known, (b) there is no mapping and the refs differ, (c) mapping throws, or
  (d) the mapped payload fails `definition.payloadSchemaRef` validation.
- The two disagree in two cases, and static validation cannot see either one:
  1. **Ref drift.** The stored event's `payload_schema_ref` differs from what the catalog says now. This happens
     when the catalog was edited, or when `submitWorkflowEventAction` stored the submitter's `payloadSchemaRef`
     even though it conflicts with the catalog (`schema_ref_conflict`, L3775-3803).
  2. **Data shape.** Real event data, after mapping, fails the workflow payload schema (worker skip (d)).
     Simulate replay already checks this through `validateWorkflowPayloadForReplay`.

A replay at publish time is therefore the only check that covers these cases. It is cheap: one indexed
`getLatestByEventName` read plus an in-memory mapping and zod parse.

## Decisions

1. **Guide text: replay is the default verify step for event triggers.** The verify step says: for event-triggered
   workflows, simulate with `useLatestEvent: true` (or `eventId` for a specific event). Send an explicit `payload`
   only for non-event triggers, or when no event of that type has been stored (the 404 "No stored workflow runtime
   event found…"). The step explains three outcomes:
   - `payloadSource: "replayed-event"` with `status: completed` means the trigger contract was checked against
     real data.
   - "Production would skip this event" means production would never launch this definition for that event. Fix it
     by adding `trigger.payloadMapping`, or by setting `payloadSchemaRef` to the event's source schema ref. A
     "failed workflow payload schema" replay failure means the same thing: production would skip the event.
   - The "payload synthesized from schema…" warning means the trigger contract was **not** checked, so this
     simulate does not count as verification.
2. **Keep the pitfall in sync, but short.** Change pitfall L305 to: validate, then simulate with
   `useLatestEvent: true` for event triggers; a synthesized-payload warning means the trigger contract was not
   checked. The full explanation lives in the verify step only, so the two texts do not drift.
3. **Use the same wording on every surface.** Update `workflows.json` playbook step 7, the simulate route
   description, and the simulate playbook to match. Then run `npm run mcp:registry:generate` to regenerate
   `ee/server/src/chat/registry/apiRegistry.generated.ts`. Do not hand-edit the generated file.
4. **Document `eventId` / `useLatestEvent` in the OpenAPI body** (`unversionedPublicV1.ts`), noting that they
   cannot be combined with `payload`. Then regenerate `sdk/docs/openapi/*` with `npm -w sdk run openapi:generate`
   (or the repo's equivalent; check the script before running it).
5. **Publish warning: include it, and make it non-blocking.** The check:
   - Runs only after `computeValidation` returns no errors, only for event triggers, and only when `tenant` is set.
     It uses the post-inference `definition`, so an inferred `payloadSchemaRef` is honoured.
   - Replays `getLatestByEventName(knex, tenant, trigger.eventName)`. If no event is stored, it adds **no warning**
     (acceptance: "absent otherwise").
   - When the replay reports a would-skip, it appends one `PublishError` to the response warnings:
     `{ severity: 'warning', stepPath: 'root.trigger', code: 'LATEST_EVENT_WOULD_SKIP', message }`.
     The message is the replay message followed by
     ` (latest stored "<event>" event <event_id> at <occurred_at>)`.
     `stepPath: 'root.trigger'` makes the designer show the warning in the trigger panel
     (`triggerValidationWarnings`, WorkflowDesigner.tsx ~L1983). The panel's
     `suppressTriggerMappingValidation` filter only hides `root.trigger.payloadMapping*`, so this warning is not
     hidden by it.
   - The check is wrapped in try/catch. Any exception is logged and dropped, so the check can never fail or delay a
     publish beyond the single read. The check does not affect `ok`, and there is no gate or override.
   - The warning goes **only into the response**. It is not merged into the persisted `validation_warnings` or
     `validation_status`, because it describes one point-in-time event and not the definition. Persisting it would
     leave a stale warning on the version record. Add `latestEventReplay: 'ok' | 'would-skip' | 'no-event' |
     'error'` to the publish audit `details` so the outcome is still recorded.
   - The simulate rate limiter is not applied: publish is already `publish`-permission gated and much less frequent.
6. **Extract the replay into one helper. Do not copy it.** Lift the body of `replayStoredEvent` (L1729-1795)
   together with `validateWorkflowPayloadForReplay` and `simulationSecretResolver` into a module-level function:

   ```ts
   type StoredEventReplay =
     | { kind: 'no-event' }
     | { kind: 'wrong-event-type'; event: EventRef }
     | { kind: 'would-skip'; reason: 'schema-ref-mismatch' | 'missing-source-ref' | 'mapping-failed' | 'payload-invalid';
         message: string; issues: unknown[]; payload: Record<string, unknown>; event: EventRef }
     | { kind: 'ok'; payload: Record<string, unknown>; mappingApplied: boolean; event: EventRef };

   async function replayStoredEventAgainstDefinition(params: {
     knex: Knex; tenant: string; definition: WorkflowDefinition; eventTrigger: WorkflowEventTrigger;
     eventId?: string;           // omitted → latest for eventTrigger.eventName
   }): Promise<StoredEventReplay>
   ```

   Both callers turn this result into their own response. Simulate maps `no-event` to 404 and `wrong-event-type`
   to 400, maps `would-skip` to its existing `status: 'failed'` result, and runs `simulateWorkflowDefinition` on
   `ok`. Publish maps `would-skip` to the warning and ignores the other kinds. The existing message strings stay
   unchanged, so the current simulate tests still pass without edits.
7. **Close two gaps between the helper and the worker.** Both are cheap and make the helper's result match what
   the worker actually does:
   - **Missing source ref.** The worker skips when no source ref is known, even if a mapping exists
     (`missingSchemaRef`). The current replay gate only checks this when no mapping is present. The helper returns
     `would-skip`/`missing-source-ref` whenever the effective ref is null, with a message that starts with
     "Production would skip this event: no source payload schema is known…".
   - **Mapping errors.** The worker treats a mapping exception as a skip. Today, simulate lets the exception
     propagate as a 500. The helper catches it and returns `mapping-failed` with
     "Production would skip this event: trigger payload mapping failed: …".
   For simulate, both are improvements: an authored mistake now comes back as a structured failure, not a 500.
8. **Out of scope:** surfacing the warning in a toast or new UI (the existing trigger-panel warning list and the
   warnings-count badge are enough), checking more than the latest event, and any publish gate.

## Files to change

| File | Change |
|---|---|
| `shared/workflow/runtime/designer/authoringGuide.ts` | Rewrite authoringLoop verify step (L136) and pitfall (L305) per decisions 1-2. |
| `shared/workflow/runtime/designer/__tests__/authoringGuide.test.ts` | New test: verify step contains `useLatestEvent: true`, `eventId`, `Production would skip this event`, `payloadMapping`, `payloadSchemaRef`, and the synthesized-warning meaning; the pitfalls entry mentions `useLatestEvent`; neither still says "realistic payload". |
| `ee/docs/api-registry/workflows.json` | Playbook step 7, the simulate description, and the simulate playbook (decision 3). |
| `ee/server/src/chat/registry/apiRegistry.generated.ts` | Regenerated via `npm run mcp:registry:generate`. |
| `server/src/lib/api/openapi/routes/unversionedPublicV1.ts` | Add `eventId` (uuid) and `useLatestEvent` (boolean) to `WorkflowDefinitionSimulateBody`, and add replay to the route description. |
| `sdk/docs/openapi/alga-openapi*.{yaml,json}`, `docs/openapi/*` if affected | Regenerated. |
| `ee/packages/workflows/src/actions/workflow-runtime-v2-actions.ts` | Extract `replayStoredEventAgainstDefinition` (decision 6, plus the fidelity fixes in decision 7); simulate calls it; `publishWorkflowDefinitionAction` runs the non-blocking check (decision 5) after validation, before `WorkflowDefinitionVersionModelV2.create`, appending to the returned `warnings` only. |
| `ee/packages/workflows/src/actions/workflow-runtime-v2-simulate.test.ts` | Existing replay tests must pass unchanged. Add: mapping throws → failed `Production would skip…mapping failed`; source ref null with mapping → failed `missing-source-ref`. |
| `ee/packages/workflows/src/actions/workflow-runtime-v2-publish-replay-warning.test.ts` (new) | Uses the same mocking harness as the simulate test (persistence models mocked; `WorkflowDefinitionModelV2.getById` returns a workflow; the `max` query, `create`, and `update` are stubbed). Cases are listed below. |

### Publish test cases

1. Latest stored event has `payload_schema_ref` `payload.Other.v1`, the catalog (mocked `EventCatalogModel`) says
   `payload.Event.v1`, the definition says `payload.Event.v1` with no mapping. Static validation passes and
   publish returns `ok: true`. `warnings` contains `code: 'LATEST_EVENT_WOULD_SKIP'`, `stepPath: 'root.trigger'`,
   and a message that contains "Production would skip this event" and the event id.
2. Latest event ref matches. The warning is absent.
3. No stored event. The warning is absent and `ok: true`.
4. Latest event payload fails the workflow schema. The warning is present (reason `payload-invalid`).
5. `getLatestByEventName` throws. Publish still returns `ok: true` and the warning is absent.
6. Validation errors present. The replay is not attempted (`getLatestByEventName` not called).
7. Non-event (time/date) trigger. The replay is not attempted.
8. The warning is not passed into `WorkflowDefinitionVersionModelV2.create` / `WorkflowDefinitionModelV2.update`
   `validation_warnings`.

## Sequence

1. Helper extraction and simulate refactor; run the simulate tests (`npx vitest run
   ee/packages/workflows/src/actions/workflow-runtime-v2-simulate.test.ts`).
2. Decision 7 fidelity fixes, with their tests.
3. Publish check and its test file.
4. Guide text and guide test (`npx vitest run shared/workflow/runtime/designer/__tests__/authoringGuide.test.ts`).
5. Registry JSON and OpenAPI source, then the two regenerations. Review the generated diffs: they should contain
   only these strings.
6. Typecheck the touched packages. Live smoke on the dev server (:3773):
   - Run `GET /api/workflow/registry/authoring-guide` and confirm `useLatestEvent` appears in the verify step.
   - Publish a draft whose trigger ref matches the catalog but whose latest stored event carries a different ref
     (submit one via `POST /api/workflow/events` with an explicit `payloadSchemaRef`). The warning should appear
     in the response and in the designer trigger panel.
   - Publish a draft with a matching event. There should be no warning.

## Acceptance mapping

- The guide's verify step names `useLatestEvent`. Covered by the guide test and the live GET.
- Existing authoring-guide tests are updated or extended. Covered by the new test case; the existing cases are
  unaffected.
- The publish warning appears when the trigger schema ref does not match the latest event, and is absent
  otherwise. Covered by publish test cases 1-3 and the live smoke.
