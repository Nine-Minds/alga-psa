# Release v1.6 UI gates

## Scope and approval
Robert approved the review recommendations on September 6, with one shared release-v1-6-feature flag and UI-only gating. Hide new options for usage/unit contract semantics, invoice ticket layouts, ticket comment attachments, schedule Teams meeting creation, manual month-end close, and store-only questionnaire authoring. Xero account-code exports remain available as the recommended customer fix.

## Goals and users
MSP and portal users do not discover these new options until the flag is enabled. Existing records remain usable and display their actual values.

## Non-goals
No new API, route, execution, billing-calculation or migration restrictions. No changes to security fixes. Replace the previous independent store-only flag with the shared flag; UI presentation is sufficient.

## Acceptance
Flag off (including unresolved/default) hides new options. Flag on restores them. Existing saved records, rendering, downloads, meeting lifecycle and billing semantics continue to operate. Targeted behavioral checks and appropriate TypeScript checks pass.

## Rollout
Default off; enable release-v1-6-feature for rollout. No database migration. Existing development flag overrides continue to work.
