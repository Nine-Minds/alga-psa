# Scratchpad — N8n Contact CRUD Node Expansion

- Plan slug: `n8n-contact-crud`
- Created: `2026-03-14`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-03-14) First pass is ticket-style parity for contacts, but limited to CRUD only: `Create`, `Get`, `List`, `Update`, and `Delete`.
- (2026-03-14) Contact `Search` is explicitly out of scope for the first pass.
- (2026-03-14) First-pass field scope is limited to `full_name`, `email`, `client_id`, `role`, `notes`, `is_inactive`, and `phone_numbers`.
- (2026-03-14) `phone_numbers` will be exposed as a JSON-authored field in the n8n node instead of a more complex nested collection UI.
- (2026-03-14) Client selection for contacts should reuse the existing client lookup/manual UUID fallback pattern already used by ticket fields.
- (2026-03-14) This work should stay in the `n8n-nodes-alga-psa` package unless implementation uncovers an actual backend gap.
- (2026-03-14) Contact list stays limited to the agreed core filters (`client_id`, `search_term`, `is_inactive`) even though the API supports broader filtering; this keeps the first pass aligned with the PRD scope.
- (2026-03-14) Contact list pagination uses dedicated internal parameter names (`contactPage`, `contactLimit`) with the same user-facing labels (`Page`, `Limit`) to avoid conflicting duplicated node parameter names.
- (2026-03-14) The packaged contact example uses a `Create -> Update` flow so the README demonstrates both the new contact resource and how downstream nodes can consume the returned `contact_name_id`.

## Discoveries / Constraints

- (2026-03-14) The existing node implementation is concentrated in `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts`; contact support should avoid turning that file into a second one-off monolith.
- (2026-03-14) The backend already exposes `POST/GET /api/v1/contacts` plus `GET/PUT/DELETE /api/v1/contacts/{id}` through `ApiContactController`.
- (2026-03-14) The contact API schema in `server/src/lib/api/schemas/contact.ts` confirms `phone_numbers` is an array of objects with required `phone_number` and optional `canonical_type`, `custom_type`, `is_default`, `display_order`, and `contact_phone_number_id`.
- (2026-03-14) The contact list API supports at least `client_id`, `search_term`, and `is_inactive`; broader filter exposure remains a product choice, not a technical blocker.
- (2026-03-14) The package already has strong test coverage patterns in `__tests__/node-description-loadoptions.test.ts`, `__tests__/node-execute.test.ts`, `__tests__/helpers.test.ts`, and `__tests__/docs.test.ts`; new coverage should extend those tests instead of adding a separate style.
- (2026-03-14) There is already a pre-plan design note at `docs/plans/2026-03-14-n8n-contact-crud-design.md`.
- (2026-03-14) The outer node execute loop already centralizes continue-on-fail error wrapping, so contact continue-on-fail support comes “for free” once contact operations throw the same normalized validation/API errors as ticket operations.
- (2026-03-14) `phone_numbers` validation now happens entirely in local helpers before request dispatch, covering malformed JSON, non-array values, missing `phone_number`, invalid optional UUIDs, non-boolean `is_default`, and negative/non-integer `display_order`.

## Commands / Runbooks

- (2026-03-14) Inspect node package surface:
  - `rg -n "ticket|contact|n8n" packages/n8n-nodes-alga-psa -g '!**/dist/**'`
- (2026-03-14) Inspect contact API contract:
  - `sed -n '1,260p' server/src/lib/api/schemas/contact.ts`
  - `sed -n '1,260p' server/src/lib/api/controllers/ApiContactController.ts`
  - `sed -n '1,260p' server/src/test/e2e/api/contacts.e2e.test.ts`
- (2026-03-14) Validate the plan after edits:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-14-n8n-contact-crud`
- (2026-03-14) Validate the implemented contact node surface:
  - `npm run typecheck`
  - `npx vitest run --config vitest.config.ts __tests__/helpers.test.ts __tests__/node-description-loadoptions.test.ts __tests__/node-execute.test.ts`
- (2026-03-14) Final verification after docs/example updates:
  - `npm test`
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-03-14-n8n-contact-crud`

## Links / References

- Design doc:
  - `docs/plans/2026-03-14-n8n-contact-crud-design.md`
- Node package:
  - `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/AlgaPsa.node.ts`
  - `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/helpers.ts`
  - `packages/n8n-nodes-alga-psa/nodes/AlgaPsa/transport.ts`
  - `packages/n8n-nodes-alga-psa/README.md`
  - `packages/n8n-nodes-alga-psa/RELEASE_NOTES.md`
- Existing tests:
  - `packages/n8n-nodes-alga-psa/__tests__/node-description-loadoptions.test.ts`
  - `packages/n8n-nodes-alga-psa/__tests__/node-execute.test.ts`
  - `packages/n8n-nodes-alga-psa/__tests__/helpers.test.ts`
  - `packages/n8n-nodes-alga-psa/__tests__/docs.test.ts`
- API contract:
  - `server/src/lib/api/schemas/contact.ts`
  - `server/src/lib/api/controllers/ApiContactController.ts`
  - `server/src/app/api/v1/contacts/route.ts`
  - `server/src/app/api/v1/contacts/[id]/route.ts`

## Progress Log

- (2026-03-14) Completed `F001` through `F023` and `T001` through `T033`.
  - Added `Contact` resource and `contactOperation` selector to the node description.
  - Added contact create/update/list parameter groups, `contactId`, client lookup reuse, and contact execute branches for `POST/GET/PUT/DELETE /api/v1/contacts` plus `GET /api/v1/contacts`.
  - Added contact helper builders for create/update/list plus local `phone_numbers` parsing and validation.
  - Extended node description, helper, and execute tests to cover resource exposure, payload/query construction, normalization, delete success objects, ID validation, and continue-on-fail behavior.
- (2026-03-14) Completed `F024` through `F026` and `T034` through `T037`.
  - Updated the README operation matrix, contact field guidance, lookup behavior notes, and output expectations.
  - Added `examples/create-update-contact.workflow.json` and referenced it from the README.
  - Added a `0.3.0` release-note entry for the first-pass contact CRUD expansion and extended docs-sync tests.
