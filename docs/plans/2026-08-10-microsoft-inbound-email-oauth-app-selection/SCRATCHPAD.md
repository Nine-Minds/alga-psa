# Scratchpad

## Chosen architecture

Persist issuer identity on the inbound-email provider row and make it authoritative at callback and runtime. Creation and reconnection use an explicit managed-or-tenant-profile selection. The tenant `Email` binding supplies only a UI/default suggestion and a conservative legacy hint. OAuth state binds tenant, provider, issuer choice, client ID, nonce, and purpose; callback validation is repeated before atomic credential and issuer persistence.

## Rejected alternatives

- **Binding-authoritative resolution:** rejected because bindings can change independently, can reference Teams or another application, and can silently change the token issuer or trigger `AADSTS50011`.
- **Duplicated client secrets:** rejected because it creates divergent secret lifecycles and unnecessary sensitive state. Reuse `client_secret_ref` and resolve the selected profile or managed secret through the existing secret mechanism.

## Relevant paths already inspected

- `server/src/components/settings/integrations/InboundEmailSettings.tsx`
- `server/src/components/settings/integrations/MicrosoftProviderForm.tsx`
- `server/src/lib/actions/email-actions/inboundEmailActions.ts`
- `server/src/lib/email/microsoft/microsoftOAuth.ts`
- `server/src/lib/email/microsoft/microsoftGraphAdapter.ts`
- `server/src/lib/models/inboundEmailProvider.ts`
- `server/src/lib/models/microsoftProfile.ts`
- `server/migrations/20250626165000_add_microsoft_profile_to_inbound_email_providers.cjs`

These paths identify implementation touchpoints; names should be re-confirmed immediately before implementation if repository movement occurred.

## Migration reuse

Reuse the existing migration-backed `microsoft_profile_id` and `client_secret_ref` fields. Treat `client_id` as authoritative for managed and legacy rows. Add only a conservative same-client data backfill if needed; do not duplicate secrets or alter Teams rows.

## Worktree preservation

`package-lock.json` is an unrelated user modification. Do not edit, restore, or stage it. Stage only the five planning artifacts in this plan set.

## Validation commands

```bash
jq empty docs/plans/2026-08-10-microsoft-inbound-email-oauth-app-selection/features.json
jq empty docs/plans/2026-08-10-microsoft-inbound-email-oauth-app-selection/tests.json
jq -e 'all(.[]; .implemented == false) and ((map(.id) | unique | length) == length)' docs/plans/2026-08-10-microsoft-inbound-email-oauth-app-selection/features.json
jq -e 'all(.[]; .implemented == false) and ((map(.id) | unique | length) == length)' docs/plans/2026-08-10-microsoft-inbound-email-oauth-app-selection/tests.json
git diff --check
git status --short
```
