# Smoke evidence digest — card 0d8d6b1c

Source: `/tmp/alga-smoke-evidence/security-2-findings-contractsim-20261031T102956Z` on robert-X670E-Pro-RS, digested 2026-10-31T10:43:46Z. Text only: 00-provenance.txt plus every .json and .txt file. Screenshots, video, .vtt and .js are excluded.

## 00-provenance.txt

```
# Provenance
Sat Oct 31 10:29:56 AM UTC 2026
hostname: robert-X670E-Pro-RS
worktree: /home/robert/alga-copies/feature-security-2-findings-in-contractsimulationactions
branch: feature/security-2-findings-in-contractsimulationactions
HEAD: 14e61e56580e9485c6d7cf0806fb9df482979718
fix(billing): gate contract simulator on Pro tier server-side and bound simulation horizon
status: 0 dirty paths
dev-server :3515 pid 1701027 cwd: /home/robert/alga-copies/feature-security-2-findings-in-contractsimulationactions/server

sha256 of changed files:
70b3affa0a4af325 23475B ee/server/src/__tests__/unit/contractSimulator.hypotheticalPeriods.test.ts
95c9955b39f71aaf 13442B ee/server/src/lib/billing/simulator/hypotheticalPeriods.ts
20d64ccd4641388d 1705441B package-lock.json
d7b657b73ba96718 2738B packages/billing/package.json
e1a859a22012e3a5 9471B packages/billing/src/actions/contractSimulationActions.refusals.test.ts
bf07cca5ed038cdb 9320B packages/billing/src/actions/contractSimulationActions.ts
3ca213e6f1bfe0fd 14521B packages/billing/vitest.config.ts
63b521f4f3fe04f0 1326B packages/licensing/src/index.ts
53de8dd0a2c9892b 1313B packages/licensing/src/lib/tenant-tier-access.ts
53ddc054d54977d2 27249B packages/types/src/interfaces/contractSimulation.interfaces.ts
fdc2e50aa86494d2 1733B server/src/lib/tier-gating/assertTierAccess.ts

guard call sites:
40:async function assertContractSimulatorAccess(
162:    await assertContractSimulatorAccess(user, tenant);
187:    await assertContractSimulatorAccess(user, tenant);
210:    await assertContractSimulatorAccess(user, tenant);
211:    assertSimulationPeriodCountWithinBounds(scenario?.horizon?.period_count);
234:    await assertContractSimulatorAccess(user, tenant);
235:    assertSimulationPeriodCountWithinBounds(scenario?.horizon?.period_count);
236:    assertSimulationPeriodCountWithinBounds(periodCount);
258:    await assertContractSimulatorAccess(user, tenant);
259:    assertSimulationPeriodCountWithinBounds(scenario?.horizon?.period_count);
279:    await assertContractSimulatorAccess(user, tenant);

Compiled server chunk containing the guard (proves running server built from this tree):
server/.next-dev/dev/server/chunks/ssr/packages_07hnom8qxcohx._.js
server/.next-dev/dev/server/chunks/ssr/packages_16s24iuczfqfw._.js

Server-action IDs replayed (from server/.next-dev/dev/server/app/msp/billing/page/server-reference-manifest.json on this host):
  getContractScenarioSnapshot 7f5421eef169db7600c42db1def9252bc7dab93528
  getContractDraftSimulationScenario 7fac7a6b6c18aa8ba5a392ec408d545134c6ffeba6
  runContractSimulation 7f67e767e03d7e68714ea99ff9973009207e0887e1
  getRecentContractSimulationAssumptions 7fd54946f663ec182e8646aa0a51383f62b11fc202
  getContractSimulationReplayAssumptions 7f5099727ccda93e820f0329d2ed8a25a1a9bbc74e
  listContractSimulationClients 7f92f12899b731487ead6655c26ca40a4096e7324f

VERIFIER NOTE: the path /home/robert/alga-copies/feature-security-2-findings-in-contractsimulationactions exists on TWO hosts.
This run, the fix commit 14e61e5658 and the dev-server all live on robert-X670E-Pro-RS. The hub's copy of the same path is a
separate, stale filesystem (HEAD 551c09cda1) and will falsely show the guard missing. Verify with:
  ssh robert-X670E-Pro-RS 'cd /home/robert/alga-copies/feature-security-2-findings-in-contractsimulationactions && git log -1 --format=%H && grep -c assertContractSimulatorAccess packages/billing/src/actions/contractSimulationActions.ts'
The error strings in screenshots 02/04/07 ("A simulation can span at most 120 billing periods", TierAccessError from the
simulator actions) are produced only by the code in that commit.

```

## 03-db-license-token-nulled.txt

```
[{"id":1,"license_token":null,"edition_choice":"ee"}]

```

## 08-db-license-token-restored.txt

```
[{"id":1,"tok_len":297}]

```

## 10-db-final-license-state.txt

```
[{"id":1,"tok_len":297}]

```

## smoke-walkthrough.json

```
{
  "version": 1,
  "title": "Security: 2 findings in contractSimulationActions.ts smoke test",
  "paneId": "0f2b8092-f7d0-49be-9f1f-082356af2b56",
  "startedAt": "2026-10-31T10:31:00.268Z",
  "finishedAt": "2026-10-31T10:34:51.051Z",
  "durationMs": 76749,
  "width": 1280,
  "height": 724,
  "bytes": 3007417,
  "frames": 1050,
  "marks": [
    {
      "t": 0,
      "label": "Flow 1: Pro tenant - Simulate tab runs a 12-period simulation (regression)"
    },
    {
      "t": 9.937,
      "label": "Flow 2: Pro tenant - tampered horizon replayed to runContractSimulation is rejected (ContractSimulationBoundsError); 120 accepted"
    },
    {
      "t": 13.987,
      "label": "Flow 3: Essentials tenant (license removed) - all six simulator server actions refused with TierAccessError"
    },
    {
      "t": 20.895,
      "label": "Flow 4: fresh Essentials session - Simulate tab shows upgrade notice; direct action still refused"
    },
    {
      "t": 54.167,
      "label": "Flow 5: Pro restored - fresh session, simulator works again (no regression for entitled tenants)"
    }
  ],
  "files": {
    "video": "smoke-walkthrough.webm",
    "chapters": "smoke-walkthrough.vtt"
  }
}
```

