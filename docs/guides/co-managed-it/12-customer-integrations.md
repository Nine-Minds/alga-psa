# Customer-owned integrations

Customer provider credentials belong to the customer workspace. Email, staff identity and directory setup must retain that ownership through configuration, callbacks and background processing.

## Before you start

Use a customer administrator with the relevant settings permissions, isolated Google/Microsoft test application credentials or approved simulator bindings, controlled staff/requester mailboxes, and running delivery/ingestion workers. Use a separate configuration for failure and revocation cases.

Start at [Customer Email settings](http://feature-co-managed-it.localhost:23374/msp/settings/email) or [Email and identity providers](http://feature-co-managed-it.localhost:23374/msp/co-management/providers). Confirm the avatar is the customer, not Oz. The provider workbench is intentionally narrower than the full PSA integration catalog.

The last fixture catalog reported **Nine Minds Managed** email, not the historical SMTP binding. It also reported production-mode emulator SSO disabled. A healthy Graph or SMTP simulator does not establish working identity, directory or inbound-email acceptance. Ask the environment operator to prepare a supported test binding if this blocks the flow; do not replace the active provider blindly.

## Risks to check

- Customer credentials being stored or used under the sponsor tenant.
- Staff sign-in or directory provisioning crossing tenants or bypassing seats.
- Requester replies joining the wrong work item or private audience.
- Revoked credentials or sharing still allowing queued delivery or inbound mutation.

## 1. Save customer-owned provider configuration

1. Open Email settings as the customer and use **Open Providers** when configuring a Google/Microsoft application, or open the provider page directly.
2. In the provider workbench, choose the prepared provider and enter only the operator-supplied test application settings required by that provider's current form.
3. Save through the provider's own control, return to Email settings, and reload both views.
4. Compare the customer configuration with the sponsor's separate settings using a separate sign-in.

Expected: the customer owns the persisted binding and return navigation works. Secrets remain redacted. Accounting, RMM and payment configuration do not become available merely because the customer can configure email/identity providers. Provider-specific field sets differ; do not invent a universal SMTP Test Connection button for the current managed-email binding.

## 2. Exercise staff sign-in and callback

Use the configured provider's normal application sign-in entry with a prepared customer staff identity. Complete the provider redirect and callback, then inspect the returned session's organization and permissions. Sign out and repeat with the same identity.

Expected: the user lands in the intended customer workspace without duplicate identities or sponsor access. The setup must preserve issuer, signature, state, nonce and audience checks. A direct database session, simulator health response or disabled SSO callback is not a substitute for this journey.

## 3. Provision or sync a directory user

Use the customer-supported directory setup for the prepared provider; have the operator supply its actual entry point if that deployment has no customer-facing control. Provision one uniquely named technician inside the available seat allocation, reload Users and check its role and workspace. Repeat the same sync and then revoke the test identity through the supported directory mechanism.

Expected: one user is provisioned once, seat limits still apply, and revocation prevents new access. If no supported customer directory entry/control is available, record **Blocked: directory setup entry not prepared**. The provider credentials page alone does not demonstrate directory provisioning.

## 4. Deliver a message and ingest the reply

On a disposable requester-enabled ticket or task, send a requester-audience message. Check the actual controlled recipient mailbox and record the work item, recipient and message correlation without tokens. Reply through that email's intended reply path, wait for the configured ingestion worker, then reload the same work item.

Expected: one reply appears on the correct customer work item with requester attribution. Duplicate delivery does not create duplicate comments. Shared-IT and organization-private bodies/files must not be disclosed to the requester. Check attachment bytes and audience separately if the prepared provider supports that flow.

## 5. Check revoked bindings and paused relationships

On the isolated test binding, revoke the provider credential and attempt another supported send/sync/ingestion. Use a separate departure/lapse fixture to test queued work across a lifecycle change, then renew only through the supported setup.

Expected: failures are visible, revoked access is not silently reused, and deferred work does not mutate or disclose content while unauthorized. Recovery must process the permitted operation once, rather than duplicating already-delivered mail or comments.

## Pass criteria and recovery

Record configuration, sign-in, directory, outbound and inbound results individually. Pass requires actual application/provider round trips and visible persisted outcomes. Label simulator evidence as simulator evidence; real-provider production acceptance remains separate. Restore reversible test bindings without erasing sent-mail or ingestion evidence, and revoke temporary test application secrets through the provider's normal controls.

## Source references

- [Customer provider workbench](../../../server/src/components/co-managed/CoManagedProviderSetup.tsx)
- [Provider route and capability boundary](../../../server/src/app/msp/co-management/providers/page.tsx)
- [Inbound requester reply handling](../../../packages/co-managed/src/inboundRequesterReply.ts)
- [Integration completion requirements](../../plans/2026-09-20-co-managed-it-completion/PRD.md)
