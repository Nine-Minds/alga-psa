# Release note: payment confirmation emails are now sent

The "Send payment confirmations" payment setting now does what it says. When a payment is recorded against an invoice
and the setting is on, the client's billing recipient gets one localized "Payment received" email for that payment.

**What changes for you**
- **The setting defaults to on, and it now takes effect.** Tenants that never touched the toggle will start sending
  confirmations for new payments. Turn "Send payment confirmations" off under payment settings to stop them.
- **Which payments send:** online payments (Stripe, Alternative Payments) and payments entered manually by staff.
- **Which never send:** payments imported by the QuickBooks/Xero sync, so a sync or backfill cannot email a client's
  payment history.
- The email goes to the same billing recipient as invoice emails, in the client's/contact's language. A client with no
  billing email is skipped.
- Each payment produces at most one confirmation, even if the event is replayed. Adds the
  `payment_confirmation_emails` table (tenant, payment_id) to track this.
