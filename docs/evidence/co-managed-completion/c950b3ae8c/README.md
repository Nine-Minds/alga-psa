# Generated completion gate

Candidate publication: `c950b3ae8ccf4423289a20510bd1dde2a8f6c1ea`.
Actual running/recorded application: `cd28aa9531f7bd465711f90b92bf8592185d9c77`,
`build-1792904848073`. The publication changes documentation and review tooling;
it does not relabel the deployed distribution.

Generated with the existing tools:

```sh
node scripts/collect-co-managed-candidate-facts.mjs --candidate c950b3ae8ccf4423289a20510bd1dde2a8f6c1ea --out docs/evidence/co-managed-completion/c950b3ae8c/candidate-facts.json
node scripts/build-co-managed-inventory.mjs --candidate c950b3ae8ccf4423289a20510bd1dde2a8f6c1ea --facts docs/evidence/co-managed-completion/c950b3ae8c/candidate-facts.json --out docs/evidence/co-managed-completion/c950b3ae8c
node scripts/verify-co-managed-completion.mjs --candidate c950b3ae8c --json
```

The collector's runtime fields were supplemented with measured build/process
observations linked in its input facts. No requirement row or readiness rule was
hand-edited. Inventory generation reports zero missing/substituted/duplicate ID
failures and preserves all 260 rows. The verifier reads the actual manifest,
evaluates coverage, exits **1**, and reports all three readiness predicates false.
Its counts are **258 implemented-unverified / 2 blocked-external**. It also reports
PR conflicts, missing current CI, preserved untracked files, incomplete review
stability observations and actual runtime/publication revision differences.

[Current production evidence](../../co-managed-deploy/cd28aa9531f7/README.md)
contains real partial journeys, post-start Temporal business effects, operator
restore and fourteen distinct recorded guides with verified playback/seeking.
The default source census deliberately promotes none of those partial journeys
to a complete requirement verdict. A playable guide is not full acceptance.
Review the [remaining acceptance](remaining-acceptance.md), the source census,
and runtime limitations together. Historical packets remain untouched.
