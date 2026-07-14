# Customer Reply Draft: Xero Sync

Hi Matt,

We reproduced the Xero 500 and found several error paths in the accounting export flow that were reaching the browser as server errors. One case was a database migration mismatch. Other expected validation failures were also being returned as raw errors. We have fixes in progress so these cases give clear, actionable messages instead.

Live Xero invoice export is available in Enterprise. We verified the complete outbound flow against a Xero demo organisation, including creating the export in AlgaPSA and confirming the draft invoices in Xero.

The inbound half of two-way sync is not live yet. We have now scoped that work around Xero invoice, payment, and credit-note changes using the existing accounting sync engine.

We will let you know when the export fixes are available for you to retest.
