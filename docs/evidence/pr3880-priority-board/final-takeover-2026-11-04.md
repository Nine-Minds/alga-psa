# PR #3880 — completed mitigation verification

Application source under test: `ceea010c606f94bd2fbf504603471cc9e27e812e` on Ryzen. It matches the committed application source at `7ed5e379d4fe6d3dfd1158fbd60ec0043b9e8ebb`; later commits contain evidence only. The local uncommitted validator edit was preserved and was **not** served or included in these checks. No matching approved plan was found; verification follows the card specification.

## Service recovery

The original board-managed `dev-server:1` now has a step-scoped hold through **2026-11-04 05:29:35 UTC**. Its command, host, port and session were preserved. No separate app server was started.

The deployed agent already implemented `resumeService({wantForMs})`, but `workflow-ensure-service` did not expose it. Repeated ensures therefore relaunched the process with an expired hold and lifecycle stopped it seconds later. On both X670E and Ryzen, the active `20261104000126-g692866e297/service/index.mjs` now forwards an explicit positive duration, bounded to four hours, to that existing method before taking the ordinary ensure path. Backup: `service/index.mjs.before-pr3880-hold`. Both user agent services were restarted. The successful command was:

```sh
alga-dev workflow-ensure-service \
  --projectId=d4555320-ddb9-46dd-ac25-5ad49bc25721 \
  --name=dev-server --wantForMs=14400000 --actor='agent:Draft Implementation'
```

This operational patch and the earlier HostRouter `projectName` fix need to be carried into an Alga Dev release; a bundle replacement can remove them. They are outside the PSA repository. The service remained live throughout verification, well beyond the earlier expiration. Final probes to the card hostname returned HTTP 200 for both `/api/health` (`{"status":"ok","version":"1.0.0"}`) and `/auth/msp/signin`. See the [service record](final-service-2026-11-04.json). The capability alias remains mapped to `../packages/core/src/lib/capability.ts`.

The viewer/browser and board respond. NATS health returned `ok`; the metadata leader was X670E and both metadata followers were current. The stream snapshot still had 24 streams with at least one non-current replica, so full cluster convergence is **not** claimed. No replica configuration or stream data was changed. See [NATS snapshot](final-nats-status-2026-11-04.json).

## Live checks

- **Templates:** the earlier checks in this same mitigation run cover both cross-family warnings/refused saves, the missing-reference warning/refused save, and a valid repair retained after reload and confirmed in the DB. See [current mitigation record](current-mitigation-2026-11-04.md), [missing priority](missing-priority-warning-2026-11-04.png), and [persisted repair](valid-template-repair-reloaded-2026-11-04.png). Those checks used the same application source as this final takeover.
- **Manual ticket:** TIC001328 offered only ITIL priorities on ITIL Support. Switching to Technical Issues cleared the incompatible priority, offered only custom priorities, and required selection of a destination status. The staged edit was cancelled; the original board and priority remain stored. See [ITIL options](final-ticket-itil-options.png) and [custom options](final-ticket-custom-options.png).
- **REST:** actual authenticated `PUT /api/v1/tickets/6a894b17-0878-48ca-a3ee-1c90a38d8f08` and `POST /api/v1/tickets` with an ITIL board/custom priority both returned HTTP 400, `VALIDATION_ERROR`, and an actionable `priority_id` explanation. The existing ticket remained unchanged. A temporary QA-owned API key was deleted in `finally`. See [responses and DB confirmation](final-live-rest-2026-11-04.txt).
- **Definition cascade:** the preceding browser checks refused the custom definition-board override inheriting P3, accepted a matching custom priority, and confirmed persistence before restoring fixtures. See [definition refusal](schedule-definition-mismatch-refused-2026-11-04.png) and [matching save](schedule-definition-matching-pair-saved-2026-11-04.png).
- **Client cascade:** saving White Rabbit's custom board override with inherited template P3 was refused in the real client-override dialog: “Priority ‘P3 - Medium’ is an ITIL priority but board ‘Technical Issues’ uses custom priorities; edit the schedule”. The dialog was cancelled. See [refusal](final-client-cascade-refused.png).
- **Real generator:** bare maintenance event `adbe1c8f-f427-468c-8a5d-fbf81d6a39d2` produced four **new November 5** occurrences at `2026-11-04T01:32:23Z`: d10/client d11 created TIC001346; d10/client d12 failed for its board override; d20/client d21 failed for the definition board override; d20/client d22 created TIC001347 because its custom-priority override repaired the pair. Both failed rows contain the actionable priority/board message. See [exact occurrence rows](final-generator-occurrences-2026-11-04.json), [client history](final-generator-client-history.png), and [definition history](final-generator-definition-history.png).

[Recorded browser walkthrough](final-walkthrough-2026-11-04.webm) with [chapters](final-walkthrough-2026-11-04.vtt) and [metadata](final-walkthrough-2026-11-04.json) captures ticket options, the client save refusal, generator histories and the staged board change. The recording includes navigation/compilation delays; screenshots and DB rows provide the concise evidence.

## Database preservation and validation

Only `server_card_d4555320` was used. The two smoke schedules were temporarily activated for a new November 5 occurrence with two lead days; other tenant schedules were paused. Their original active flags, start dates, lead days, client overrides and evaluation watermarks were restored afterward. New occurrence/ticket rows were retained as smoke evidence. No shared database migration or production write was performed. The [restoration audit](final-restoration-2026-11-04.json) confirms zero configuration differences and zero temporary API keys.

Direct Vitest logs from the preceding round were retrieved and reviewed: [priority/template/generator](final-integration-priority-template-generator.log), 48/48; [recurring actions](final-integration-recurring-actions.log), 17/17. They ran on serving source `ceea010c...`; the isolated DB snapshot was restored after testing. The same application source already passed 70 focused UI tests, tickets/server typechecks and the production build in the preceding round. This takeover changed no application source, so those results remain applicable; tests were not rerun against the restored live fixtures.

The [production report](production-counts.md) remains informational: 11,947 open-ticket priority mismatches across 18 tenants; 1,480 category mismatches across five; template/recurring counts zero. Customer cleanup requires separate captain approval.
