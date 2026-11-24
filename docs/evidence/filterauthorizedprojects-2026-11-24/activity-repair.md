# Project activity authorization verification

The activity reader now retains the authenticated reader's project authorization decision and loads masked task, phase, and project projections. Denied projects are omitted before activity filtering, counts, and pagination. Every selected task column participates in masking, and source redactions propagate to dependent status and priority values.

## Runtime regressions

Sixteen new behavioral cases failed against builder revision `2fd7ef891849d84acff1ea52f5a2f5625ed7938c` before the repair. They now pass. Populated fixtures cover direct task columns, source-table aliases, dependent names/colors/closed state, separate project decisions, denied reads, restoration, and tenant/project isolation. Earlier activity regressions also cover filtering, pagination, reader propagation, and cache transitions.

- Focused project checks: 71 tests passed across the projection, project/task actions, and masked-WBS UI tests.
- Full user-activities suite: 165 tests passed across 49 files. Its resolver now follows package export maps for the authorization dependency chain.
- Full co-managed suite: 210 tests passed across 19 files; its package typecheck passed.
- Project build, targeted ESLint, and diff checks passed. ESLint reported existing `any` and `__dirname` warnings.
- The new `@alga-psa/projects/activityRead` source entry resolves through the app's project source alias.

The full project suite reports 690 passing tests and five failures. The same five failures reproduce on the builder revision: four obsolete source-text contracts and a missing tag-suggestion mock in `QuickAddServiceDefaults.test.tsx`. These files were not changed by this repair.

Projects and user-activities typechecks report identical diagnostic locations before and after this repair. Projects has five errors in unchanged shared UI editor files. User-activities also has a binding-type error in `shared/lib/ticketChecklists/applyTemplates.ts`. Comparison logs are in `/tmp/alga-authz-takeover-wp197ir6/typecheck-comparison.json`; baseline test failures are recorded beside them.

## Live UI and action comparison

Verified on 2026-11-24 using the existing board-owned server on port 3397. Its process started on November 21 and its working directory is this checkout's `server` directory. No server was started or restarted during the repair.

The browser session was `qa@emeraldcity.oz` in tenant `6d178771-ad9a-4d43-8809-83992745f8f9`. The project detail route was `/msp/projects/04c441a9-6c71-4c45-b8ff-1b5505e81585`. The comparison used the existing REVIEW-2041 task and the dedicated review policy controlled by `evidence-20261124/scenario.cjs` in the saved review guide.

| Policy state | Task detail and activity result | Project task-list UI |
| --- | --- | --- |
| Baseline | Original title, phase, WBS, and status mapping agree; five project activities | Original task and phase labels visible |
| Combined redaction | Both return `Project task`, `Project phase`, null WBS, and null status mapping | Protected task and phase labels absent; masked labels render |
| Denied | Task detail returns no task; zero project activities and zero projects | Not reloaded during denial |
| Restored | Responses exactly match the baseline | Original task label visible again |

These were real browser requests to registered server actions. Application responses were not mocked. The policy's original disabled assignment and configuration were restored exactly in a cleanup block, including on assertion failure. No project, task, tag, or other assignment was changed.

Raw action responses, UI text, screenshot references, policy snapshots, and the repeatable comparison script are saved under `/tmp/alga-authz-takeover-wp197ir6/`. Start with `live-summary.json`, `policy-before.json`, and `policy-after.json`.

The named `security-finding-resolved` acceptance check was not invoked. These results do not grant that external acceptance gate.
