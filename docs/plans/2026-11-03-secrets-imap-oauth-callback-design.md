# Design — Security: secrets in GET

## Finding (confirmed on main)

The IMAP OAuth callback (server/src/app/api/email/oauth/imap/callback/route.ts:19-35,59-75) validates state only by age, is API-key exempt, trusts a caller-supplied x-tenant-id, then POSTs the stored client secret to the row's oauth_token_url.

## Approach

1. Signed, single-use, tenant-bound state (HMAC over tenant+provider+nonce+expiry), rejected before any DB read.
2. Resolve tenant from verified state, not the header.
3. assertSafeOutboundUrl on the stored token URL before the POST.

## Hand-off
This file is the spec the Link Spec step links to this card's PSA ticket; record it in state.psaSpecPaths.
