# Stripe Payment Integration Plan

## Purpose & Overview

Deliver a comprehensive payment integration system that enables MSP customers to pay their invoices via Stripe directly from invoice emails. The solution implements an abstract payment provider architecture to support future payment platforms while integrating seamlessly with existing billing, accounting export, and transaction tracking systems.

Primary outcomes:
- **Abstract Payment Provider Interface**: Extensible architecture supporting Stripe initially with provisions for PayPal, Square, and other providers.
- **Stripe Invoice Payment Links**: Generate secure payment links included in invoice emails, allowing customers to pay invoices online.
- **Payment Recording & Synchronization**: Automatically record Stripe payments in Alga PSA transactions, update invoice statuses, and maintain correlation between Stripe and PSA records.
- **Configuration UI**: Tenant-facing settings to connect Stripe accounts, configure payment options, and manage payment method preferences.
- **Accounting Integration**: Ensure payments flow correctly to Xero and QuickBooks integrations via the existing accounting export architecture.

---

## Discovery Highlights *(Completed)*

### Existing Stripe Infrastructure
The codebase already contains a Phase 1 Stripe integration focused on **license management** for the PSA platform itself (Nine Minds billing tenants for PSA licenses). Key components:
- **Database Schema** (`ee/server/migrations/20251014120000_create_stripe_integration_tables.cjs`): Tables for `stripe_accounts`, `stripe_customers`, `stripe_products`, `stripe_prices`, `stripe_subscriptions`, `stripe_webhook_events`.
- **StripeService** (`ee/server/src/lib/stripe/StripeService.ts`): 1,114-line service handling customer management, subscription lifecycle, webhook processing, and license tracking.
- **Webhook Handler** (`server/src/app/api/webhooks/stripe/route.ts`): Endpoint processing checkout completions and subscription events.
- **License Actions** (`ee/server/src/lib/actions/license-actions.ts`): Server actions for license purchasing and management.

### Billing & Invoice System
Comprehensive billing infrastructure exists:
- **BillingEngine** (`server/src/lib/billing/billingEngine.ts`): Central charge calculation supporting fixed, hourly, usage, bucket, and license billing.
- **Invoice Service** (`server/src/lib/services/invoiceService.ts`): Invoice creation, tax distribution, and totals calculation.
- **Payment Recording** (`server/src/lib/api/services/InvoiceService.ts`): `recordPayment()` method (lines 684-767) handling payment insertion, status updates, and transaction recording.
- **Transaction System** (`server/src/lib/utils/transactionUtils.ts`): `recordTransaction()` for ledger entries with balance tracking.
- **Email Delivery** (`server/src/lib/jobs/handlers/invoiceEmailHandler.ts`): Job-based PDF generation and email sending.
- **Email Templates** (`server/src/utils/email/emailService.tsx`): Basic templating with `{{placeholder}}` substitution.

### Accounting Export Architecture
Adapter-based system for accounting integrations:
- **Abstract Adapter** (`server/src/lib/adapters/accounting/accountingExportAdapter.ts`): Interface defining `transform()`, `deliver()`, `postProcess()` methods.
- **Entity Mapping** (`tenant_external_entity_mappings` table): Tracks relationships between Alga entities and external system IDs.
- **Xero/QBO Adapters**: Implementations for invoice export with OAuth credential management.
- **Payment Sync Endpoint** (`server/src/app/api/v1/integrations/quickbooks/payments/sync/route.ts`): Existing QBO payment synchronization infrastructure.

### Gaps Identified
- No customer-facing payment portal or payment link functionality
- No Stripe PaymentIntent/Checkout integration for invoice payments
- No payment provider abstraction layer (current Stripe code is license-specific)
- Invoice emails contain PDF only, no "Pay Now" link
- No client-facing Stripe customer mapping (only tenant-level for license billing)
- No webhook handling for payment events (only subscription events)

---

## Scope & Deliverables

### In Scope
- Abstract `PaymentProvider` interface with Stripe implementation
- Stripe Checkout/Payment Links for invoice payments
- Client-level Stripe customer creation and mapping
- Payment webhook handling (payment_intent.succeeded, checkout.session.completed)
- Automatic payment recording in transactions table
- Invoice status updates on payment
- Payment link inclusion in invoice emails
- Tenant configuration UI for Stripe integration
- Client portal payment page
- Payment reconciliation with accounting exports
- Multi-currency support aligned with invoice currency

### Out of Scope (Future Iterations)
- Alternative payment providers (PayPal, Square, ACH)
- Recurring payment schedules / autopay
- Partial payment workflows (pay portion of invoice)
- Refund processing through UI
- Stripe Connect for marketplace scenarios
- Payment dispute/chargeback handling UI

---

## Phase 1 – Abstract Payment Provider Architecture

### Payment Provider Interface

Create extensible payment provider abstraction:

```typescript
// server/src/interfaces/payment.interfaces.ts

export interface PaymentProviderCapabilities {
  supportsPaymentLinks: boolean;
  supportsHostedCheckout: boolean;
  supportsEmbeddedCheckout: boolean;
  supportsWebhooks: boolean;
  supportedCurrencies: string[];
  supportsPartialPayments: boolean;
  supportsRefunds: boolean;
}

export interface CreatePaymentLinkRequest {
  invoiceId: string;
  amount: number; // cents
  currency: string;
  description: string;
  customerId?: string;
  metadata: Record<string, string>;
  expiresAt?: Date;
  returnUrl: string;
  cancelUrl?: string;
}

export interface PaymentLinkResult {
  paymentLinkId: string;
  url: string;
  expiresAt?: Date;
  provider: string;
}

export interface PaymentWebhookEvent {
  eventId: string;
  eventType: string;
  provider: string;
  payload: unknown;
  invoiceId?: string;
  amount?: number;
  currency?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
}

export interface PaymentProvider {
  readonly providerType: string;

  capabilities(): PaymentProviderCapabilities;

  // Customer management
  getOrCreateCustomer(clientId: string, email: string, name: string): Promise<string>;

  // Payment link generation
  createPaymentLink(request: CreatePaymentLinkRequest): Promise<PaymentLinkResult>;

  // Webhook handling
  verifyWebhookSignature(payload: string, signature: string): boolean;
  parseWebhookEvent(payload: string): PaymentWebhookEvent;

  // Payment retrieval
  getPaymentDetails(paymentId: string): Promise<PaymentDetails>;
}
```

### Database Schema Extensions

```sql
-- Payment provider configuration per tenant
CREATE TABLE payment_provider_configs (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  provider_type VARCHAR(50) NOT NULL, -- 'stripe', 'paypal', etc.
  is_enabled BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,
  configuration JSONB DEFAULT '{}', -- Provider-specific config
  credentials_vault_path TEXT, -- Path to secrets
  webhook_secret_vault_path TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(tenant, provider_type)
);

-- Client to payment provider customer mapping
CREATE TABLE client_payment_customers (
  mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  client_id UUID NOT NULL REFERENCES companies(company_id),
  provider_type VARCHAR(50) NOT NULL,
  external_customer_id VARCHAR(255) NOT NULL, -- stripe: cus_xxx
  email VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(tenant, client_id, provider_type)
);

-- Payment links for invoices
CREATE TABLE invoice_payment_links (
  link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  invoice_id UUID NOT NULL REFERENCES invoices(invoice_id),
  provider_type VARCHAR(50) NOT NULL,
  external_link_id VARCHAR(255) NOT NULL, -- stripe: plink_xxx or cs_xxx
  url TEXT NOT NULL,
  amount INTEGER NOT NULL, -- cents
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(50) DEFAULT 'active', -- active, expired, completed, cancelled
  expires_at TIMESTAMP,
  completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(tenant, invoice_id, provider_type)
);

-- Payment webhook events (extends existing stripe_webhook_events pattern)
CREATE TABLE payment_webhook_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  provider_type VARCHAR(50) NOT NULL,
  external_event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  invoice_id UUID REFERENCES invoices(invoice_id),
  processed BOOLEAN DEFAULT false,
  processing_status VARCHAR(50) DEFAULT 'pending',
  processing_error TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(tenant, provider_type, external_event_id)
);

-- Indexes
CREATE INDEX idx_payment_configs_tenant ON payment_provider_configs(tenant);
CREATE INDEX idx_client_payment_customers_client ON client_payment_customers(tenant, client_id);
CREATE INDEX idx_payment_links_invoice ON invoice_payment_links(tenant, invoice_id);
CREATE INDEX idx_payment_webhook_events_processed ON payment_webhook_events(tenant, processed, created_at);
```

### Phase 1 Tasks
- [ ] Create payment provider interface definitions
- [ ] Create database migration for payment tables
- [ ] Implement PaymentProviderRegistry for provider management
- [ ] Add RLS policies for new tables
- [ ] Create base PaymentService orchestration layer

---

## Phase 2 – Stripe Payment Provider Implementation

### Stripe Provider Service

Extend existing StripeService or create dedicated `StripePaymentProvider`:

```typescript
// ee/server/src/lib/payments/stripe/StripePaymentProvider.ts

export class StripePaymentProvider implements PaymentProvider {
  readonly providerType = 'stripe';

  async getOrCreateCustomer(clientId: string, email: string, name: string): Promise<string> {
    // Check client_payment_customers first
    // If not found, create in Stripe and store mapping
    // Return external_customer_id
  }

  async createPaymentLink(request: CreatePaymentLinkRequest): Promise<PaymentLinkResult> {
    // Create Stripe Checkout Session in 'payment' mode
    // Store in invoice_payment_links
    // Return URL for email inclusion
  }

  async handlePaymentSucceeded(event: Stripe.Event): Promise<void> {
    // Extract invoice_id from metadata
    // Record payment via InvoiceService.recordPayment()
    // Update invoice status
    // Update invoice_payment_links status
  }
}
```

### Stripe Checkout Integration

Use Stripe Checkout Sessions for secure, hosted payment pages:

```typescript
// Payment link creation
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  customer: customerId,
  line_items: [{
    price_data: {
      currency: invoice.currency || 'usd',
      product_data: {
        name: `Invoice ${invoice.invoice_number}`,
        description: `Payment for services from ${tenantName}`,
      },
      unit_amount: invoice.total_amount, // Already in cents
    },
    quantity: 1,
  }],
  metadata: {
    tenant_id: tenantId,
    invoice_id: invoiceId,
    invoice_number: invoice.invoice_number,
    client_id: clientId,
  },
  success_url: `${baseUrl}/portal/invoices/${invoiceId}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${baseUrl}/portal/invoices/${invoiceId}`,
  expires_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
});
```

### Webhook Handler Extension

Extend webhook endpoint to handle payment events:

```typescript
// server/src/app/api/webhooks/stripe/payments/route.ts

// New events to handle:
// - checkout.session.completed (payment mode)
// - payment_intent.succeeded
// - payment_intent.payment_failed

switch (event.type) {
  case 'checkout.session.completed':
    if (session.mode === 'payment') {
      await stripePaymentProvider.handleCheckoutCompleted(event);
    }
    break;
  case 'payment_intent.succeeded':
    await stripePaymentProvider.handlePaymentSucceeded(event);
    break;
  case 'payment_intent.payment_failed':
    await stripePaymentProvider.handlePaymentFailed(event);
    break;
}
```

### Phase 2 Tasks
- [ ] Implement StripePaymentProvider class
- [ ] Add Stripe Checkout Session creation logic
- [ ] Extend webhook handler for payment events
- [ ] Implement customer creation/mapping for clients
- [ ] Add payment recording integration with InvoiceService
- [ ] Create payment link storage and retrieval
- [ ] Add idempotency handling for webhook events
- [ ] Implement payment status polling fallback

---

## Phase 3 – Invoice Email Payment Links

### Email Template Enhancement

Modify invoice email system to include payment links:

```typescript
// Enhanced email template with payment link
private async getInvoiceEmailTemplate(hasPaymentLink: boolean) {
  return {
    subject: 'Invoice {{invoice_number}} from {{company_name}}',
    body: `
      <p>Dear {{client_name}},</p>
      <p>Please find attached your invoice {{invoice_number}} for {{total_amount}}.</p>
      ${hasPaymentLink ? `
      <p>
        <a href="{{payment_link}}" style="background-color: #4CAF50; color: white; padding: 14px 20px; text-decoration: none; display: inline-block; border-radius: 4px;">
          Pay Now - {{total_amount}}
        </a>
      </p>
      <p>Or copy this link: {{payment_link}}</p>
      ` : ''}
      <p>Thank you for your business!</p>
      <p>Best regards,<br>{{company_name}}</p>
    `
  };
}
```

### Invoice Email Handler Updates

Modify `invoiceEmailHandler.ts` to generate payment links:

```typescript
// In InvoiceEmailHandler.handle()

// Check if payment provider is configured
const paymentService = await PaymentService.create(tenantId);
const hasPaymentProvider = await paymentService.hasEnabledProvider();

let paymentLinkUrl: string | undefined;
if (hasPaymentProvider && invoice.status !== 'paid') {
  const paymentLink = await paymentService.getOrCreatePaymentLink({
    invoiceId: invoice.invoice_id,
    amount: invoice.total_amount,
    currency: invoice.currency || 'USD',
    description: `Invoice ${invoice.invoice_number}`,
    metadata: {
      tenant_id: tenantId,
      client_id: client.client_id,
    },
    returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/portal/invoices/${invoice.invoice_id}/payment-success`,
  });
  paymentLinkUrl = paymentLink.url;
}

// Pass to email template rendering
invoice.paymentLink = paymentLinkUrl;
```

### Phase 3 Tasks
- [ ] Create PaymentService orchestration layer
- [ ] Add payment link generation to invoice email flow
- [ ] Update email templates with payment button/link
- [ ] Add tenant setting for enabling payment links in emails
- [ ] Handle expired payment links (regenerate on resend)
- [ ] Add payment link to invoice PDF (optional configurable)

---

## Phase 4 – Payment Recording & Invoice Status Updates

### Payment Recording Flow

```
Stripe Webhook (payment_intent.succeeded)
    │
    ▼
StripePaymentProvider.handlePaymentSucceeded()
    │
    ├─► Extract invoice_id from metadata
    │
    ├─► Idempotency check (payment_webhook_events)
    │
    ├─► InvoiceService.recordPayment({
    │       invoice_id,
    │       amount,
    │       payment_method: 'stripe',
    │       reference_number: payment_intent_id,
    │       notes: `Stripe payment ${charge_id}`
    │   })
    │
    ├─► Update invoice_payment_links status = 'completed'
    │
    ├─► Emit INVOICE_PAYMENT_RECEIVED event
    │
    └─► Log to payment_webhook_events as processed
```

### Transaction Recording

Payments create transaction records via existing infrastructure:

```typescript
// In InvoiceService.recordPayment() - already exists
// Ensure integration captures Stripe metadata

await recordTransaction(trx, {
  clientId: invoice.client_id,
  invoiceId: invoice.invoice_id,
  amount: paymentAmount,
  type: 'payment',
  description: `Payment received - ${paymentMethod}`,
  metadata: {
    payment_provider: 'stripe',
    stripe_payment_intent_id: referenceNumber,
    stripe_charge_id: chargeId,
  }
}, tenant);
```

### Status Synchronization

```typescript
// Invoice status transitions
// Current statuses: draft, sent, paid, partially_applied, overdue, prepayment, pending, cancelled

async function updateInvoicePaymentStatus(invoiceId: string, paymentAmount: number) {
  const invoice = await getInvoice(invoiceId);
  const totalPaid = await getTotalPayments(invoiceId);

  if (totalPaid >= invoice.total_amount) {
    await updateInvoiceStatus(invoiceId, 'paid');
  } else if (totalPaid > 0) {
    await updateInvoiceStatus(invoiceId, 'partially_applied');
  }
}
```

### Phase 4 Tasks
- [ ] Integrate payment recording with existing InvoiceService.recordPayment()
- [ ] Add Stripe metadata to transaction records
- [ ] Implement automatic invoice status updates
- [ ] Create payment confirmation email notification
- [ ] Add payment history to invoice detail view
- [ ] Implement payment receipt generation
- [ ] Add event emission for payment workflows

---

## Phase 5 – Configuration UI

### Settings Page Structure

```
/msp/settings/billing/payments
├── Payment Providers
│   ├── Stripe (Connect/Disconnect)
│   │   ├── API Key Configuration (Secret + Publishable)
│   │   ├── Webhook Status Display (auto-configured)
│   │   └── Test Connection Button
│   └── [Future: PayPal, Square]
├── Payment Settings
│   ├── Enable Payment Links in Emails (toggle)
│   ├── Payment Link Expiration (selector)
│   ├── Payment Confirmation Emails (toggle)
│   └── Allow Partial Payments (toggle - future)
└── Payment History
    └── Recent Payments Table
```

### Automatic Webhook Configuration

When a user connects their Stripe account, webhooks are configured automatically using the Stripe API. This eliminates the need for users to manually configure webhooks in the Stripe Dashboard.

**Webhook Events Subscribed:**
- `checkout.session.completed` - Primary event for completed payments
- `payment_intent.succeeded` - Backup/direct payment confirmations
- `payment_intent.payment_failed` - Failed payment notifications

**Implementation Flow:**
```typescript
// During connectStripeAction:
const webhookEndpoint = await stripe.webhookEndpoints.create({
  url: `${baseUrl}/api/webhooks/stripe/payments`,
  enabled_events: [
    'checkout.session.completed',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
  ],
  description: `Alga PSA payment webhook for tenant ${tenantId}`,
  metadata: { tenant_id: tenantId, created_by: 'alga-psa' },
});

// The webhook secret is returned in the response and stored securely
await secretProvider.setTenantSecret(tenant, 'stripe_payment_webhook_secret', webhookEndpoint.secret);
```

**Benefits:**
- Zero manual configuration required from users
- Correct events are always subscribed
- Webhook secret is automatically stored for signature verification
- Webhook endpoint is cleaned up on disconnect

**Fallback:**
If automatic webhook creation fails (e.g., due to API rate limits or network issues), the UI displays the webhook URL and required events for manual configuration.

### Server Actions

```typescript
// ee/server/src/lib/actions/payment-actions.ts

export async function connectStripeAction(credentials: StripeCredentials) {
  // 1. Validate API key by fetching account info
  // 2. Store credentials in secret provider
  // 3. Automatically create webhook endpoint via Stripe API
  // 4. Store webhook endpoint ID and secret
  // 5. Create payment_provider_configs record
  // Return { publishableKey, webhookConfigured }
}

export async function disconnectStripeAction() {
  // 1. Delete webhook endpoint from Stripe
  // 2. Clear webhook secret from vault
  // 3. Disable provider config
}

export async function updatePaymentSettingsAction(settings: PaymentSettings) {
  // Update tenant payment preferences
}

export async function getPaymentConfigAction() {
  // Return config including webhook_status, webhook_url, webhook_events
}
```

### Phase 5 Tasks
- [x] Create payment settings page component
- [x] Implement Stripe credential input and validation
- [x] Implement automatic webhook configuration via Stripe API
- [x] Add webhook status display (auto-configured vs manual)
- [x] Create payment provider enable/disable toggles
- [x] Add payment link preferences UI
- [x] Implement server actions for configuration
- [ ] Add test payment functionality
- [ ] Create payment activity log viewer

---

## Phase 6 – Client Portal Payment Experience

### Payment Page

```typescript
// server/src/app/(portal)/portal/invoices/[invoiceId]/pay/page.tsx

export default async function PayInvoicePage({ params }: Props) {
  const invoice = await getPortalInvoice(params.invoiceId);
  const paymentLink = await getActivePaymentLink(params.invoiceId);

  if (invoice.status === 'paid') {
    return <PaymentAlreadyComplete invoice={invoice} />;
  }

  if (!paymentLink) {
    return <PaymentNotAvailable />;
  }

  // Redirect to Stripe Checkout or embed
  return <StripeCheckoutRedirect url={paymentLink.url} />;
}
```

### Payment Success Page

```typescript
// server/src/app/(portal)/portal/invoices/[invoiceId]/payment-success/page.tsx

export default async function PaymentSuccessPage({ params, searchParams }: Props) {
  const { session_id } = searchParams;

  // Verify payment completed (webhook may not have fired yet)
  const paymentStatus = await verifyStripePayment(session_id);

  return (
    <PaymentConfirmation
      invoice={invoice}
      paymentStatus={paymentStatus}
      receiptUrl={paymentStatus.receipt_url}
    />
  );
}
```

### Phase 6 Tasks
- [ ] Create portal payment initiation page
- [ ] Implement payment success/failure pages
- [ ] Add payment status polling for immediate feedback
- [ ] Create payment receipt display
- [ ] Add "Pay Now" button to portal invoice list
- [ ] Implement payment history in client portal
- [ ] Handle payment link expiration gracefully

---

## Phase 7 – Accounting Integration

### Payment Export Coordination

Payments must sync to accounting systems alongside invoices:

```typescript
// Extend accounting export to include payments

interface AccountingPaymentExport {
  payment_id: string;
  invoice_id: string;
  invoice_external_id?: string; // QBO/Xero invoice ID
  amount: number;
  currency: string;
  payment_date: Date;
  payment_method: string;
  reference: string;
  metadata: {
    stripe_payment_intent_id?: string;
    stripe_charge_id?: string;
  };
}
```

### Xero Payment Integration

```typescript
// server/src/lib/adapters/accounting/XeroAdapter.ts

async exportPayment(payment: AccountingPaymentExport) {
  // Get Xero invoice ID from mapping
  const invoiceMapping = await getMappingForInvoice(payment.invoice_id);

  // Create Xero Payment
  await xeroClient.payments.create({
    Invoice: { InvoiceID: invoiceMapping.external_entity_id },
    Account: { Code: bankAccountCode },
    Date: payment.payment_date,
    Amount: payment.amount / 100,
    Reference: payment.reference,
  });
}
```

### QuickBooks Payment Integration

```typescript
// server/src/lib/adapters/accounting/QuickBooksOnlineAdapter.ts

async exportPayment(payment: AccountingPaymentExport) {
  // Get QBO invoice ID from mapping
  const invoiceMapping = await getMappingForInvoice(payment.invoice_id);

  // Create QBO Payment
  await qboClient.payments.create({
    CustomerRef: { value: customerMapping.external_entity_id },
    TotalAmt: payment.amount / 100,
    Line: [{
      Amount: payment.amount / 100,
      LinkedTxn: [{
        TxnId: invoiceMapping.external_entity_id,
        TxnType: 'Invoice'
      }]
    }],
    PaymentRefNum: payment.reference,
    PaymentMethodRef: { value: getPaymentMethodId('stripe') },
  });
}
```

### Phase 7 Tasks
- [ ] Extend accounting export interfaces for payments
- [ ] Implement Xero payment creation
- [ ] Implement QBO payment creation
- [ ] Add payment to accounting export batches
- [ ] Create payment mapping storage
- [ ] Handle payment-invoice correlation in exports
- [ ] Add payment export status tracking
- [ ] Implement payment export error handling

---

## Phase 8 – Testing & Quality Assurance

### Unit Tests
- [ ] PaymentProvider interface compliance tests
- [ ] StripePaymentProvider method tests
- [ ] Payment link generation tests
- [ ] Webhook signature verification tests
- [ ] Payment recording tests

### Integration Tests
- [ ] End-to-end payment flow (Stripe test mode)
- [ ] Webhook event processing
- [ ] Invoice status transitions
- [ ] Email template rendering with payment links
- [ ] Accounting export with payments

### Playwright Tests
- [ ] Payment settings configuration
- [ ] Payment link in invoice email
- [ ] Client portal payment flow
- [ ] Payment success/failure pages
- [ ] Payment history display

### Phase 8 Tasks
- [ ] Create test fixtures for payment scenarios
- [ ] Implement Stripe test mode helpers
- [ ] Add webhook event simulation
- [ ] Create payment flow integration tests
- [ ] Add UI automation tests
- [ ] Perform load testing for concurrent payments
- [ ] Security audit of payment handling

---

## Schema Overview (ASCII)

```
                           +---------------------------+
                           | payment_provider_configs  |
                           |---------------------------|
                           | config_id (PK)            |
                           | tenant (FK)               |
                           | provider_type             |
                           | is_enabled                |
                           | is_default                |
                           | credentials_vault_path    |
                           +-------------+-------------+
                                         |
                    tenant has 1:N providers
                                         |
      +----------------------------------+----------------------------------+
      |                                                                     |
      v                                                                     v
+---------------------------+                             +---------------------------+
| client_payment_customers  |                             | invoice_payment_links     |
|---------------------------|                             |---------------------------|
| mapping_id (PK)           |                             | link_id (PK)              |
| tenant (FK)               |                             | tenant (FK)               |
| client_id (FK->companies) |                             | invoice_id (FK->invoices) |
| provider_type             |                             | provider_type             |
| external_customer_id      |<---+                        | external_link_id          |
| email                     |    |                        | url                       |
| metadata                  |    |                        | amount                    |
+---------------------------+    |                        | status                    |
                                 |                        | expires_at                |
                                 |                        +-------------+-------------+
                                 |                                      |
                                 |          links point to invoices     |
                                 |                                      v
                                 |                        +---------------------------+
                                 |                        | invoices                  |
                                 |                        |---------------------------|
                                 +----------------------->| invoice_id (PK)           |
                                   customer pays invoice  | client_id (FK)            |
                                                          | total_amount              |
                                                          | status                    |
                                                          +-------------+-------------+
                                                                        |
                                              payments recorded against invoices
                                                                        v
                                                          +---------------------------+
                                                          | invoice_payments          |
                                                          |---------------------------|
                                                          | payment_id (PK)           |
                                                          | invoice_id (FK)           |
                                                          | amount                    |
                                                          | payment_method            |
                                                          | reference_number          |
                                                          +---------------------------+
                                                                        |
                                                          transactions recorded
                                                                        v
                                                          +---------------------------+
                                                          | transactions              |
                                                          |---------------------------|
                                                          | transaction_id (PK)       |
                                                          | invoice_id (FK)           |
                                                          | amount                    |
                                                          | type = 'payment'          |
                                                          | metadata (stripe info)    |
                                                          +---------------------------+

+---------------------------+
| payment_webhook_events    |
|---------------------------|
| event_id (PK)             |
| tenant (FK)               |
| provider_type             |
| external_event_id         |
| event_type                |
| event_data                |
| invoice_id (FK)           |
| processed                 |
| processing_status         |
+---------------------------+
```

---

## Dependencies & Integration Points

### Existing Systems
- **Invoice System**: `invoices`, `invoice_payments`, `transactions` tables
- **Email System**: `invoiceEmailHandler.ts`, `emailService.tsx`
- **Accounting Export**: `AccountingExportAdapter`, `tenant_external_entity_mappings`
- **Secret Provider**: Credential storage via `@alga-psa/core/secrets`
- **Event Bus**: Payment events for workflow triggers

### External Services
- **Stripe API**: Checkout Sessions, Payment Intents, Customers, Webhooks
- **Xero API**: Payments endpoint for payment sync
- **QuickBooks Online API**: Payments endpoint for payment sync

### New Components
- `PaymentProvider` interface and registry
- `StripePaymentProvider` implementation
- `PaymentService` orchestration layer
- Payment settings UI components
- Client portal payment pages

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Webhook delivery failures | Medium | High | Implement payment status polling fallback; store webhook events for replay |
| Payment-invoice correlation loss | Low | High | Store invoice_id in Stripe metadata; implement reconciliation tools |
| Multi-currency complexity | Medium | Medium | Start with USD; extend currency handling incrementally |
| Accounting export timing | Medium | Medium | Queue payments for batch export; handle missing invoice mappings |
| Client customer duplication | Medium | Low | Check existing customers by email before creation |
| Payment link expiration | Low | Medium | Regenerate links on invoice resend; show clear expiration messaging |
| PCI compliance concerns | Low | High | Use Stripe Checkout (hosted); never handle raw card data |

---

## Open Questions

1. **Partial Payments**: Should we support paying less than the full invoice amount initially?
2. **Payment Terms**: Should payment links respect invoice due dates for expiration?
3. **Multi-Invoice Payments**: Should customers be able to pay multiple invoices at once?
4. **Autopay**: Is recurring payment setup in scope for Phase 1?
5. **Fee Handling**: Should Stripe fees be tracked separately in transactions?
6. **Refunds**: Should refund initiation be exposed in UI, or handled externally in Stripe Dashboard?
7. **Payment Reminders**: Should unpaid payment links trigger reminder emails?
8. **Stripe Connect**: For multi-tenant scenarios, is Stripe Connect needed for payment routing?

---

## Success Metrics

### Phase 1-3 (Foundation)
- Payment provider abstraction implemented and tested
- Stripe Checkout integration functional in test mode
- Payment links generated and included in emails

### Phase 4-5 (Core Functionality)
- Payments successfully recorded from webhooks
- Invoice status updates automatically on payment
- Configuration UI deployed and functional

### Phase 6-7 (Complete Integration)
- Client portal payment flow operational
- Payments exported to Xero/QuickBooks
- < 5 minute latency from Stripe payment to PSA recording

### Production Metrics
- Payment success rate > 95%
- Webhook processing latency < 30 seconds
- Zero payment data loss
- 100% payment-invoice correlation accuracy

---

## Implementation Timeline

### Week 1-2: Foundation
- Payment provider interface design
- Database schema migration
- StripePaymentProvider skeleton

### Week 3-4: Core Stripe Integration
- Checkout Session creation
- Webhook handler implementation
- Payment recording integration

### Week 5-6: Email & UI
- Payment link in emails
- Configuration settings UI
- Client portal payment pages

### Week 7-8: Accounting & Polish
- Xero/QBO payment export
- Testing and bug fixes
- Documentation

---

## References

- [Stripe Checkout Documentation](https://stripe.com/docs/payments/checkout)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- Existing Stripe integration: `ee/server/src/lib/stripe/StripeService.ts`
- Invoice service: `server/src/lib/api/services/InvoiceService.ts`
- Accounting export plan: `ee/docs/plans/2025-10-26-accounting-export-abstraction-plan.md`
- Invoice email handler: `server/src/lib/jobs/handlers/invoiceEmailHandler.ts`
