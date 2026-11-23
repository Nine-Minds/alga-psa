# Security: authorization in getBlockContent

[Open the review guide](http://100.82.172.57:43493/).

Development-app walkthrough ready. Verified 2026-11-09T00:04:13Z at PR #4093 head `8909bd553f363ce3660763f561ffa170b4a828d9`.

The live check passed internal QA login, all three seeded deep links, Notes create/save/edit/reload on an isolated client, Documents content display, and authorized/record-denied/recovered reads on both action surfaces. Temporary objects were removed; shared QA roles and seeded payloads were preserved.

[Fresh evidence and per-item results](http://100.82.172.57:43493/evidence/implement-desk-20261109/README.md). The published guide source is `/home/robert/alga-reviews/security-authz-getblockcontent/index.html`.

Production review-app verification and human approval remain pending. This check used the development app on port 3052.
