# Release note: Stripe imports require tenant credentials

Tenant payment operations and Stripe customer/card imports no longer use the platform Stripe account when a tenant has not configured its own credentials. Tenants that previously relied on this fallback must connect their Stripe account in **Billing settings** before tenant payments or imports can resume.

The saved credentials are verified and bound to their Stripe account. Replacing credentials with keys for a different account is rejected; an operator must review the account change before the binding is changed.
