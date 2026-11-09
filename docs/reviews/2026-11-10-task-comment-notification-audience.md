# Human review: task-comment notification audience

## Finding

**High severity: task-comment notifications and emails disclose content to recipients who cannot read the parent project.** This draft follows the approved plan in `docs/plans/2026-11-10-secrets-in-handletaskcommentadded-fix-plan.md`. Its proposed source-string wiring guards were replaced with behavioral subscriber coverage.

The comment read path resolves the task's parent project and applies coarse task-read permission plus the record-level project read decision. Before this change, mention expansion and task assignment were enough to deliver comment text, project names, and task names; neither delivery path checked that same project decision.

## Review these files first

1. [Shared recipient admission](../../server/src/lib/notifications/projectNotificationAudience.ts) loads each candidate with roles, applies `project_task:read`, then calls `assertProjectReadAllowed` with the supplied connection. It skips missing users and the established permission/project-not-found denials; unexpected errors propagate.
2. [Internal notification gates](../../server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts) admit direct mentions and expanded `@everyone`, primary/additional assignees, and newly mentioned users on comment edits. Notification records are created only after admission.
3. [Email gate](../../server/src/lib/eventBus/subscribers/projectEmailSubscriber.ts) filters primary/additional assignees before email delivery.
4. [Behavioral delivery tests](../../server/src/lib/eventBus/subscribers/__tests__/taskCommentAudience.behavior.test.ts) and [helper tests](../../server/src/lib/notifications/__tests__/projectNotificationAudience.test.ts) cover denied and allowed recipients, content, author exclusion, assignee/mention overlap, edits, missing users/projects, propagated failures, and a payload project ID that conflicts with the task's database-resolved project.

Users narrowed away from a project will stop receiving that project's task-comment notifications and emails, even if they remain mentioned or assigned. Admitted recipients continue to receive the existing content and templates.

## Verification recorded for this draft

- `npx vitest run --config vitest.config.ts src/lib/notifications/__tests__/projectNotificationAudience.test.ts src/lib/eventBus/subscribers/__tests__/taskCommentAudience.behavior.test.ts src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.titles.test.ts src/lib/eventBus/subscribers/__tests__/internalNotificationSubscriber.suppression.test.ts` — 4 files, 23 tests passed.
- `npx vitest run --config vitest.config.ts src/lib/taskComments/taskCommentAuthorization.test.ts` from `packages/projects` — 1 file, 13 tests passed.
- `npm --prefix packages/projects run build` — passed.
- `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix server run build` — passed. Next compiled the production bundle and generated all 74 static pages; it reported existing warnings, including a conflicting scheduling export and dynamic-dependency warnings in unrelated modules.
- Mutation check used `npx vitest run --config vitest.config.ts src/lib/eventBus/subscribers/__tests__/taskCommentAudience.behavior.test.ts` after temporarily making its mocked admission policy allow every candidate. The delivery assertions failed in 6 of 7 tests, exposing the denied mention, edit mention, primary/additional assignee notifications, and primary/additional assignee emails. The policy mock was restored, and the clean 23-test run passed.
- `npm --prefix server run typecheck` — failed because Node exhausted its default heap without diagnostics.
- `NODE_OPTIONS=--max-old-space-size=8192 npm --prefix server run typecheck` — failed because Node exhausted its 8 GB heap without diagnostics.
- `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix server run typecheck` — passed with no diagnostics.
- No app server was started and no browser validation was performed.

## Review notes and remaining uncertainty

- Admission is per recipient. An `@everyone` comment performs one role lookup and project decision per active internal user; correctness is preferred here, and batching may be considered separately if production cost warrants it.
- A separate content-bearing consumer exists: [the search indexer](../../packages/search/src/indexers/project_task_comment.ts) stores comment body, task name, and project name for `TASK_COMMENT_ADDED` and `TASK_COMMENT_UPDATED`. Its [visibility verifier](../../packages/search/src/acl.ts) resolves the parent project and checks client access, but does not visibly call the shared record-level project authorizer. This draft does not change search behavior because the approved finding and implementation scope concern notification/email delivery. Captain should assess whether narrowed MSP users can retrieve these indexed comments and track any search authorization gap separately.
- Email delivery was exercised through the subscriber's test harness seam with the actual delivery wrapper and a spy on `sendEventEmail`. No live email provider, browser, or running application was used.
