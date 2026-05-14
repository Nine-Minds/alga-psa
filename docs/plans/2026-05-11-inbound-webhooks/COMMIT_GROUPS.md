# Commit Groups — Inbound Webhooks

This plan has 111 features. To keep history navigable, implement them in the groups below — **one commit per group**, not one commit per feature. Target: ~42 logical commits plus inline fixes during implementation.

When the loop picks "the next unimplemented feature," it should pull in all sibling features in the same group, complete them together, run the tests for the group, then commit once. If a sibling cannot be completed cleanly, split the group only when there's a real blocker — not as the default.

## Foundation (4 commits)

1. **schema: inbound webhook tables** — F001, F002
2. **infra: external-ID helpers + reserved integration_type check** — F003, F004, F005
3. **permissions: inbound_webhook resource + admin seed** — F006
4. **feature flag: inbound_webhooks_enabled** — F007

## Types and validation (2 commits)

5. **types: inbound webhook TypeScript surfaces** — F010
6. **validation: zod schemas for upsert input** — F011

## Server actions (3 commits)

7. **server actions: inbound webhook CRUD + secret rotation + active state** — F012, F013, F014, F015, F016, F017
8. **server actions: delivery log + replay** — F018, F019, F020
9. **server actions: sample capture + synthetic test** — F021, F022, F023

## Inbound HTTP route and auth (5 commits)

10. **route: /api/inbound/[tenantSlug]/[webhookSlug] handler + tenant + slug resolution** — F030, F031, F032
11. **auth: HMAC-SHA256 verifier (timing-safe)** — F033
12. **auth: Bearer + IP allowlist + path-token verifiers** — F034, F035, F036
13. **route: unified 401 + idempotency (header and JSONata sources) + dedup window** — F037, F038, F039, F040
14. **route: delivery persistence + header filtering + per-webhook rate limit + sample capture** — F041, F042, F043, F044

## Action registry (2 commits)

15. **registry: core (registerAction/listActions) + types + bootstrap loader** — F050, F051, F052, F053
16. **registry: field mapping evaluator + validation errors + lookup-miss handling** — F054, F055, F056

## Direct actions, grouped by package (5 commits)

17. **actions: ticket — create / updateByExternalId / addCommentByExternalId / changeStatusByExternalId** — F1010, F1011, F1012, F1013
18. **actions: client + contact — upsertClient / setClientActive / upsertContact** — F1020, F1021, F1030
19. **actions: asset — upsertByExternalId via ingestNormalizedRmmDeviceSnapshot + non-RMM path** — F1040, F1041
20. **actions: invoice + time entry — markPaid / updateStatus / createTimeEntry (with idempotent markPaid)** — F1050, F1051, F1052, F1060
21. **actions: project task + tag — createTask / updateTaskStatus / addTagToEntity** — F1070, F1071, F1080

## Workflow handler (2 commits)

22. **workflow: dispatcher + normalized envelope builder** — F060, F061
23. **workflow: run linkage on delivery + trigger-failure semantics** — F062, F063

## Expression editor reuse (1 commit)

24. **mapping: webhook payload context adapter + reuse ExpressionTextArea** — F070, F071, F072

## Settings UI (7 commits)

25. **ui: refactor Settings → Webhooks into tabbed shell, outbound moves into Outbound tab (no behavior change)** — F080
26. **ui: inbound webhooks list view** — F081
27. **ui: create/edit dialog — identity + auth sections + one-time secret display** — F082, F083, F084
28. **ui: idempotency section** — F085
29. **ui: handler section — direct-action dropdown + target field rows + workflow selector + envelope info card** — F086, F087, F088, F091
30. **ui: sample capture button + payload tree panel** — F089, F090
31. **ui: active toggle + auto-disable banner + i18n keys + interactive element ids** — F092, F097, F098

## Delivery log UI (2 commits)

32. **ui: delivery log list + detail drawer** — F093, F094
33. **ui: replay button + synthetic test dialog** — F095, F096

## Feature flag and permission gating (1 commit)

34. **gating: feature flag wraps Settings tab + /api/inbound/* + permission checks on every server action** — F100, F101, F102

## Public REST API (3 commits)

35. **api: REST routes — list / create / get / put / delete / rotate-secret** — F200, F201, F202, F203
36. **api: REST routes — test / capture-sample / deliveries / delivery detail / replay** — F204, F205, F206, F207, F208
37. **api: action discovery endpoint + shared auth path** — F209, F223

## OpenAPI registration (3 commits)

38. **openapi: route registration file + templated receiver endpoint** — F210, F211
39. **openapi: component schemas — config / create-input / update-input / auth-config / handler-config** — F212, F213, F214, F215
40. **openapi: component schemas — delivery / action-definition / target-field / workflow-envelope** — F216, F217, F218

## Spec regeneration and contract tests (2 commits)

41. **openapi: regenerate alga-openapi.{ce,ee}.{yaml,json}** — F220
42. **tests: contract tests for management routes + action discovery** — F221, F222

## Rules for the loop

- **One group = one commit.** Do not split groups into multiple commits unless a sibling feature genuinely blocks the others.
- **Tests for a group ship with the group.** Run the tests mapped to that group's feature IDs before committing. Failing tests do NOT block commit if they're skipped/pending and clearly noted in the commit body, but green is preferred.
- **Mark features `implemented: true` in features.json as part of the same commit.** No separate "mark done" commits.
- **If a group requires schema or type changes from a later group, defer to that group rather than reordering.** Groups are sequential by intent: foundation → types → actions → routes → registry → handlers → UI → API → OpenAPI → tests.
- **Inline fixes** (typo, type mismatch surfaced by next group) commit separately with a `fix:` prefix. Budget ~8 of these in the 50-commit envelope.
- **Commit message format** matches the group title verbatim, lowercase prefix (e.g. `actions: ticket — create / updateByExternalId / ...`).
