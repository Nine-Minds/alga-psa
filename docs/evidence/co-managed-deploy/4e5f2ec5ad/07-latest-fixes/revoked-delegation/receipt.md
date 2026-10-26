# Revoked delegated approval message (production build-1793009958637)

1. Alice (White Rabbit IT) approved QA for "Edit board display settings" on "CM-REVIEW-20261026-04 Delegation board" (grant 8a457942-bcb9-4980-b4f4-7e6a1681bcfc, approved_revision 85).
2. QA opened the delegated editor (tab A) and changed the description to "DEPLOY-4E5F stale delegated edit" without saving (deleg-qa-editor-open.png).
3. Alice revoked the approval from tab B (revoked_at 2026-10-26 11:13:51Z). QA's session was then restored in tab B; tab A was not reloaded.
4. QA saved from tab A. UI: "The customer revoked this approval, so the change was not saved. Refresh access to see the tasks still approved for you." No Retry button (deleg-revoked-message.png). PASS
5. DB: board description still "CM-REVIEW-20261026-04 original description"; 0 delegated receipts since approval. The approval remains revoked (its normal end state).
