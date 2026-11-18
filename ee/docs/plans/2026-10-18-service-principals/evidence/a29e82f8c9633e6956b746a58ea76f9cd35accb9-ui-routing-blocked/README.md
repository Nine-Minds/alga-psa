# Card C UI verification route diagnosis

- Recorded: `2026-11-03T19:22:17Z`
- Product revision: `a29e82f8c9633e6956b746a58ea76f9cd35accb9`
- Product app: existing review app at `http://127.0.0.1:23835`; revision stamp matched and `/api/health` returned HTTP 200.
- Viewer state: `list-browsers`, `browser-get-url`, and `browser-get-dom` worked, but the sole listed pane belonged to another card.
- Failing operation: project-scoped `space-new-tab --type=browser --projectId=408b0ddd-de45-4ef6-bf35-b88251c8515c` returned `Unsupported method: cli.request` through both the agent CLI socket and the local CLI socket.
- Diagnosis: the live Alga Dev viewer dispatch path does not handle `cli.request`; source inspection found the agent dispatcher lacks that case. Restoring it requires an Alga Dev runtime change/reload. The separate Alga Dev checkout is already dirty and its shared host process was not restarted.
- Verification not performed: card-specific MCP Settings UI, authorized audit-history UI, and the QA timesheet UI edit/reopen. No target-card screenshots or `smoke-walkthrough.webm`, `.vtt`, or `.json` were produced. No prior recordings were relabelled.
- Historical-only evidence: the prior HTTP `saveTimeEntry` action and earlier T003/T017 results are not fresh UI verification.

The directory records a blocked attempt. It does not contain screenshots or a walkthrough recording because no target-card viewer was available.
