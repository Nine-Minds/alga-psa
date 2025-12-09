# Email Roundtrip Implementation Plan (Holistic)
**Date:** November 18, 2025
**Status:** Planned

## Objective
Complete the email roundtrip feature by implementing outbound notification logic that ensures **channel consistency** and **correct threading**. When a ticket is created from an inbound email, any subsequent agent replies must be sent:
1.  From the **same email address** that received the original email.
2.  Via the **same provider** (Microsoft/Google) to ensure deliverability and header integrity.
3.  With correct **In-Reply-To** and **References** headers to maintain the conversation thread in the customer's email client.

## Architecture Analysis

### Current State
-   **Inbound:** `system-email-processing-workflow` creates tickets and stores `email_metadata` (including `providerId`, `messageId`, `references`).
-   **Inbound Adapters:** `MicrosoftGraphAdapter` and `GmailAdapter` currently only support reading emails.
-   **Outbound:** `TenantEmailService` uses `EmailProviderManager` to send emails, typically defaulting to a single configured outbound provider (SMTP/Resend).
-   **Subscriber:** `ticketEmailSubscriber` listens for events but doesn't currently support channel-specific routing or threading headers.

### The Gap
The current system treats inbound and outbound email as separate pipelines. There is no mechanism to "reply via the inbound channel." If `support@acme.com` (Microsoft) receives an email, the system currently replies via `noreply@platform.com` (Resend), breaking the "From" address and potentially the thread.

## Implementation Plan

### 1. Enhance Inbound Adapters (Bi-directional Capability)
Modify the existing inbound adapters to support sending emails. This allows us to reuse the existing authentication and connection logic.

*   **File:** `server/src/services/email/providers/MicrosoftGraphAdapter.ts`
    *   Implement `sendEmail(message: EmailMessage): Promise<EmailSendResult>`.
    *   Use the Graph API `/me/sendMail` or `/users/{id}/sendMail`.
    *   Map `In-Reply-To` and `References` from `message.headers` to the API payload.
*   **File:** `server/src/services/email/providers/GmailAdapter.ts`
    *   Implement `sendEmail(message: EmailMessage): Promise<EmailSendResult>`.
    *   Use the Gmail API `users.messages.send`.
    *   Construct a raw MIME message that includes the threading headers.

### 2. Upgrade EmailProviderManager (Channel Routing)
Enable the manager to route emails through specific providers based on ID, not just tenant defaults.

*   **File:** `server/src/services/email/EmailProviderManager.ts`
    *   Add method `sendEmailViaProvider(providerId: string, message: EmailMessage, tenantId: string)`.
    *   Logic:
        1.  Retrieve the provider configuration from the database using `providerId`.
        2.  Instantiate the appropriate adapter (`MicrosoftGraphAdapter` or `GmailAdapter`).
        3.  Call `adapter.sendEmail(message)`.

### 3. Update Service Layer (Context Propagation)
Pass the routing and threading information from the business logic down to the provider manager.

*   **File:** `server/src/types/email.types.ts` & `server/src/lib/email/BaseEmailService.ts`
    *   Update `EmailMessage` and `BaseEmailParams` to include:
        *   `headers?: Record<string, string>` (for threading).
        *   `providerId?: string` (for routing).
*   **File:** `server/src/lib/services/TenantEmailService.ts`
    *   Update `sendEmail` to handle `providerId`.
    *   If `providerId` is present, delegate to `providerManager.sendEmailViaProvider`.
    *   Otherwise, fall back to the default `providerManager.sendEmail`.
*   **File:** `server/src/lib/notifications/sendEventEmail.ts`
    *   Update `SendEmailParams` and `sendEventEmail` to accept and pass `providerId` and `headers`.

### 4. Wire Up the Subscriber (The Glue)
Connect the event system to the new logic.

*   **File:** `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
    *   In `handleTicketCommentAdded`:
        1.  **Filter:** Ensure comment is public and from an agent/system.
        2.  **Context:** Retrieve `ticket.email_metadata`.
        3.  **Routing:** Extract `providerId` from `email_metadata`.
        4.  **Threading:** Construct `In-Reply-To` (from `messageId`) and `References`.
        5.  **Send:** Call `sendNotificationIfEnabled` passing `providerId` and `headers`.

## UX/Configuration Considerations
*   **Implicit Configuration:** By reusing the inbound provider for replies, we avoid complex "mapping" UI. If a user connects `support@acme.com` for inbound, replies automatically go out via `support@acme.com`.
*   **Setup Screens:** No immediate changes required to Setup UI, as the "connection" already exists. Future enhancements could allow configuring a specific "Signature" or "Display Name" for the inbound channel.

## Verification Strategy
1.  **Unit Tests:** Test `sendEmail` in adapters with mocks.
2.  **Integration:** Simulate a comment on a ticket created via email. Verify `EmailProviderManager` loads the specific provider and sends the email.
3.  **Roundtrip E2E:**
    *   Send email to `inbound@test.com` -> Ticket Created.
    *   Agent replies -> Email sent via `inbound@test.com` (verified via logs/headers).
    *   Customer replies -> Thread continues correctly.