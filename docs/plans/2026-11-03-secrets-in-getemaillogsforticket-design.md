# Design — Security: secrets in getEmailLogsForTicket

## Finding (confirmed on main)

`packages/email/src/actions/emailLogActions.ts:49-64` requires coarse `ticket:read` but never authorizes the supplied ticket record; `:65-102` returns addresses, CC/BCC, subjects, provider ids, metadata, comment ids and reply-token-derived fields for any ticket UUID.

## Approach

1. Authorize read access to the specific ticket inside the transaction before querying `email_sending_logs`.
2. Trim the projection to what the ticket UI needs; drop reply-token-derived fields and provider ids except behind the privileged permission.
3. Tests: narrowed internal user cannot read another ticket's correspondence; authorized reader keeps UI fields; dropped fields need the privileged permission.

## Files in scope

emailLogActions.ts, the ticket authorization helper, and email-log action tests.

## Hand-off
Materialize this design as a file in the card worktree at the Link Spec step and record its repo-relative path in `state.psaSpecPaths`; never report `skipped-no-spec`.
