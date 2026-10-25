# Scratchpad: C6 project staging

- 2026-10-24 gate: #3818 OPEN (head dea428483c, not merged). C4 has no PR. C1/C2/C3 merged. Rebased onto origin/main 484bfecb8f.
- Result: gated; plan only. No implementation code touched (including the allocation.ts extraction).
- Board facts retired as superseded by design 5d4945b7b0: held_quantity-only / in_stock->staged decision; project_staging_containers table name.
- Watch: `projectAuthorization.contract.test.ts` greps the private authorizer source; update with the extraction.
- Watch: C3 also edits recordLinks.ts; keep the two copies byte-identical.
- Build order: see features.json (design section 4).
- 2026-10-24 gate re-check (F001): `gh pr view 3818` state=OPEN, mergedAt=null. Plan-only; no code written, plan unchanged.
- 2026-10-25: gate cleared (B1 352dab4d35, C2 #3879 merged; C4 #3890 open → D9 plain links). Rebased onto origin/main b87dbb98ba. Implemented F002-F038; see PRD "Implementation record".
- 2026-10-25 repair round: task/phase/project delete releases staging (detach installed lines + boxes), NO ACTION task FK migration, billing:create/inventory:read/asset:read gates, claim-location low-stock signal, releaseClaimedUnits FOR UPDATE.
