# Microsoft Graph outbound email implementation plan

## Goal

Allow a tenant's existing Microsoft email-provider connection to send outbound mail through Microsoft Graph, so ticket replies and every other path already routed through `TenantEmailService` / `EmailProviderManager` can use Microsoft 365 without a separate SMTP or Resend provider.

## Current code shape

- `packages/email/src/providers/EmailProviderManager.ts` owns outbound provider construction. Its factory recognizes only `smtp` and `resend`, while the persisted inbound configuration uses `provider_type = 'microsoft'`.
- `server/src/components/MicrosoftProviderForm.tsx` and the existing Microsoft OAuth callback/configuration flow already create and refresh Microsoft provider credentials for inbound Graph mail.
- Microsoft provider configuration is stored in the email-provider tables and already carries mailbox/token/refresh-token data used by webhook and inbound processing.
- Callers such as ticket replies, billing mail, and workflows already use the common email service; they should not gain Microsoft-specific branches.

## Design decisions

1. Treat `microsoft` as another implementation of the existing `IEmailProvider` contract. Keep provider selection and all outbound callers unchanged.
2. Reuse the existing Microsoft email-provider row and OAuth token lifecycle. Do not introduce a second Microsoft connection or duplicate client secrets.
3. Send as the explicitly configured mailbox. Use Graph `POST /users/{encoded-mailbox}/sendMail` rather than `/me/sendMail`, because app/shared-mailbox configurations must not depend on the token's interactive identity.
4. Extend the existing Microsoft consent request to include the least outbound permission needed by the current auth model: `Mail.Send`, plus the inbound scopes already requested. Existing connections missing the scope must show a reconnect/consent-required error rather than silently falling back to another sender.
5. Preserve the common `EmailMessage` semantics: To/Cc/Bcc, subject, HTML/text body, reply-to, attachments, and provider-neutral result/error fields. The Graph adapter performs only the wire-format conversion.
6. Graph's successful `sendMail` response normally has no message id. Return a stable successful provider result without inventing an id; retain any request/correlation id only as diagnostic metadata if the interface supports it.
7. Token refresh and one bounded retry on 401 belong in the Microsoft provider/auth helper, using the established refresh-token persistence path. Never log access tokens, refresh tokens, or full message bodies.

## Implementation sequence

### 1. Make the shared outbound types accept Microsoft

- Locate the canonical `EmailProviderConfig` / provider-type declarations exported by `@alga-psa/types` and add `microsoft` to the allowed outbound provider type.
- Update settings-loading mappings that currently narrow provider types to `smtp | resend`; keep the persisted provider id and tenant association intact.
- Confirm the manager receives the same Microsoft config that inbound services use, including provider id, mailbox address, OAuth tokens, expiry, and Microsoft profile/client binding.

### 2. Add `MicrosoftGraphEmailProvider`

Create `packages/email/src/providers/MicrosoftGraphEmailProvider.ts` implementing `IEmailProvider`, following the SMTP and Resend providers for lifecycle, capabilities, logging, and `EmailProviderError` behavior.

- Validate configuration during `initialize`: tenant/provider identity, sender mailbox, access token or refreshable credentials, and Graph endpoint inputs.
- Map `EmailMessage` to the Graph message shape: recipients, HTML/text body, reply-to, and file attachments as Graph fileAttachment objects with base64 content.
- Call `https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail` with `saveToSentItems: true`.
- Normalize Graph failures into retryable/non-retryable `EmailProviderError` values: 401/expired token triggers refresh once; 403 reports missing consent or mailbox Send As rights; 429/5xx are retryable; validation/4xx errors are not.
- Implement a lightweight health check that verifies configuration/token viability without sending mail.
- Declare no native bulk capability initially so the manager uses its existing per-message fallback.

### 3. Wire provider construction and credential resolution

- Add the `microsoft` case to `EmailProviderManager.createProvider`.
- Extend `resolveProviderConfig` (or introduce a small Microsoft-specific resolver) so the provider receives fresh credentials from the existing Microsoft email-provider configuration rather than stale client-supplied values.
- Reuse the existing Microsoft token refresh/profile-resolution utilities. If their location creates an invalid dependency direction for `packages/email`, define a narrow injected token-source interface in the email package and provide the server implementation; do not copy OAuth logic into the adapter.
- Keep tenant/provider cache invalidation behavior unchanged so reconnecting or editing the mailbox rebuilds the active provider.

### 4. Extend Microsoft consent and settings UX

- Add `Mail.Send` to the existing Microsoft email OAuth scope set and its user-facing scope disclosure.
- Update the Microsoft provider form/status copy to state that the connection supports inbound and outbound mail, identify the configured sending mailbox, and prompt existing installations to reconnect when outbound permission is absent.
- Keep sender selection tied to the configured Microsoft mailbox. Do not add arbitrary per-message From spoofing.
- Update `docs/inbound-email/setup/microsoft.md` so it no longer claims Microsoft is inbound-only and documents `Mail.Send`, shared-mailbox Send As requirements, and reconnect behavior.

### 5. Cover common and ticket-reply paths behaviorally

- Provider unit tests for message mapping, mailbox URL encoding, success, authorization/rate-limit failures, token refresh plus one retry, and secret-safe logging.
- Manager tests proving a `microsoft` config constructs and uses the Graph provider and bulk fallback sends each message.
- Settings/auth tests proving `Mail.Send` is requested and persisted Microsoft configuration initializes outbound sending.
- A service-level ticket-reply test proving a public reply selects Microsoft, preserves threading/reply-to data, and calls Graph with the configured mailbox.
- Regression coverage that SMTP/Resend selection and inbound Microsoft polling/webhooks remain unchanged.

## Manual smoke evidence

1. Reconnect a Microsoft provider and confirm consent includes `Mail.Send`.
2. Send a normal message and verify delivery plus a Sent Items copy.
3. Send a public reply from a ticket; verify it comes from the configured mailbox and replies route to the same ticket.
4. Exercise HTML, Cc/Bcc, reply-to, and a small attachment.
5. Remove `Mail.Send` or Send As permission and confirm an actionable, secret-safe authorization error.
6. Confirm inbound Graph webhook/poll processing still works.

## Deliberately out of scope

- A separate Microsoft outbound-provider database model.
- Arbitrary From spoofing or automatic mailbox discovery.
- Graph batch sending, large-attachment upload sessions, national-cloud endpoints, and delivery/read receipts.
- Microsoft-specific branches in ticket, invoice, workflow, or notification callers.

## Risks

- Existing tenants need admin re-consent for `Mail.Send`.
- Delegated vs application permissions and shared-mailbox Send As rights produce different 403 failures.
- Graph limits simple file attachments; oversized mail must fail clearly until upload sessions are implemented.
- Token helpers may be server-only; preserve package boundaries through a narrow credential source.
