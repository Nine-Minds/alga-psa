# Development acceptance checkpoint

The canonical development service and direct QA Open Review work at source
revision `4305dac1a97f004e963c390e585fb1437f79e5f0`. Production review remains
blocked by normal board admission. These checks do not complete the
[acceptance plan](../../../plans/2026-10-24-co-managed-it-acceptance/PLAN.md).

[Development observations](development-observations.json) record the actors,
qualified resource identities, routes, outcomes and remaining checks. The
customer account root renders “Page not available” after loading. Existing
shared ticket notes are visible to both organizations; each organization sees
its own private note and cannot see the other organization's private body.
The customer scope editor renders. No business mutation was submitted.

- [Customer account denial](msp-account.png)
- [Customer ticket and retained notes](msp-tickets-cfff4242-7962-4100-a54c-687eaa540500.png)
- [Worker compiler-input audit](worker-input-audit.json)

The input audit compares the incremental compiler's recorded local source
hashes with this checkout: 1,473 Temporal inputs and 602 workflow-worker inputs
match, with no missing or mismatched local source files. Both live child
processes started at `2026-10-24T18:58:47Z`. Board restart timestamps describe
wrapper activity and must not be substituted for child start times. Entry-file
timestamps in October 13 are compatible with incremental compilation, but the
input audit does not prove fresh emitted output, external package distributions
or compiled-worker business behavior.

The earlier development evidence mislabeled the shared ticket's customer
tenant as the MSP tenant and its relationship ID as the customer tenant. The
correct sponsor tenant is `24ac76c8-df59-4b10-8371-c56222904580`, customer
tenant is `1f98df77-cd15-44c2-8f4d-42ff52d01e84`, and relationship is
`c7de2b20-f1d9-4374-b7bb-c223f681955e`. The original untracked evidence has
been corrected and preserved.

Production startup must go through board admission per service. The latest
request in this takeover was denied with 28 GiB free, 19 GiB reserved and an
8 GiB host floor, against a 6 GiB application request. No production build or
start followed the denial. Do not infer admission from raw free memory or
require both application slots before requesting the first.

Account child-path behavior, multipart acceptance controls, Microsoft OIDC,
inbound providers, collaboration mutations and the full native regression
walkthrough remain unverified. The child-path navigation timed out and is not
a denial pass. All fourteen production walkthrough recordings remain missing;
their guide statuses must remain blocked. Continue from this checkpoint after
normal production admission rather than carrying these development reads
forward as production acceptance.
