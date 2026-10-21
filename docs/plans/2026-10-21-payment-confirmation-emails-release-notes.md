# Release note: payment confirmation emails are now sent

The "Send payment confirmations" payment setting now does what it says. When a payment is recorded against an invoice
and the setting is on, the client's billing recipient gets one localized "Payment received" email for that payment.

**What changes for you**
- **Default-on applies only to tenants with an enabled payment provider configuration.** Those tenants can see the
  setting; if they never touched it, they start sending confirmations for new payments. Turn "Send payment
  confirmations" off under payment settings to stop them.
- **Tenants without an enabled payment provider configuration, including Community Edition, do not receive
  confirmations**, because the setting is not available to them.
- **The email's "View Invoice" link uses the tenant's portal domain** (custom domain when active, otherwise the
  configured app URL). If no public URL can be determined, the email is still sent without the link.
- **Which payments send:** online payments (Stripe, Alternative Payments) and payments entered manually by staff.
- **Which never send:** payments imported by the QuickBooks/Xero sync, so a sync or backfill cannot email a client's
  payment history.
- The email goes to the same billing recipient as invoice emails, in the client's/contact's language. A client with no
  billing email is skipped.
- Each payment produces at most one confirmation, even if the event is replayed. Adds the
  `payment_confirmation_emails` table (tenant, payment_id) to track this.
