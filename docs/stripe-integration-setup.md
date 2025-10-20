# Stripe Integration Setup Guide

This guide walks you through setting up the Stripe integration for AlgaPSA license purchasing.

## Overview

The Stripe integration enables:
- **Phase 1 (Now):** Self-service license purchasing for existing AlgaPSA customers
- **Phase 2 (Future):** Multi-tenant billing where your customers can charge their clients

## Prerequisites

1. AlgaPSA installation with database access
2. Stripe account (sign up at [stripe.com](https://stripe.com))
3. Access to server environment variables

## Step-by-Step Setup

> **Note:** This integration is for **Enterprise Edition (Hosted)** only. The migration is located in `ee/server/migrations/`.

### 1. Database Migration

Run the EE Stripe integration migration:

```bash
cd ee/server
npm run migrate
```

This creates 6 tables:
- `stripe_accounts` - Tenant Stripe account configuration
- `stripe_customers` - Customer mapping
- `stripe_products` - Product catalog
- `stripe_prices` - Pricing information
- `stripe_subscriptions` - Active subscriptions
- `stripe_webhook_events` - Webhook idempotency tracking

### 2. Stripe Account Setup

#### 2.1 Create Stripe Account
1. Go to [stripe.com](https://stripe.com) and sign up
2. Complete business verification (required for production)
3. Keep the dashboard open for the next steps

#### 2.2 Get API Keys
1. Go to **Developers → API keys**
2. Copy the **Publishable key** (starts with `pk_test_` or `pk_live_`)
3. Click **Reveal test key** and copy the **Secret key** (starts with `sk_test_` or `sk_live_`)
4. Add to `server/.env`:
   ```bash
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```

### 3. Product Configuration

#### 3.1 Create License Product
1. Go to **Products → Create product**
2. Enter product details:
   - **Name:** AlgaPSA User License
   - **Description:** Monthly subscription for AlgaPSA user access
3. Add pricing:
   - **Pricing model:** Standard pricing
   - **Price:** $50.00 (or your pricing)
   - **Billing period:** Recurring - Monthly
4. Click **Save product**

#### 3.2 Copy Product IDs
After creating the product:
1. Copy the **Product ID** (starts with `prod_`)
2. Click on the price and copy the **Price ID** (starts with `price_`)
3. Add to `server/.env`:
   ```bash
   STRIPE_LICENSE_PRODUCT_ID=prod_...
   STRIPE_LICENSE_PRICE_ID=price_...
   ```

### 4. Webhook Configuration

#### 4.1 Create Webhook Endpoint
1. Go to **Developers → Webhooks**
2. Click **Add endpoint**
3. Enter endpoint URL:
   - **Development:** Use Stripe CLI (see below)
   - **Production:** `https://your-domain.com/api/webhooks/stripe`

#### 4.2 Select Events
Add these events to your webhook:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

#### 4.3 Get Webhook Secret
1. After creating the endpoint, copy the **Signing secret** (starts with `whsec_`)
2. Add to `server/.env`:
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### 5. Master Tenant Configuration

Find your organization's tenant ID:

```sql
SELECT tenant FROM tenants WHERE email = 'your-admin-email@domain.com';
```

Add to `server/.env`:
```bash
MASTER_BILLING_TENANT_ID=<your-tenant-uuid>
```

### 6. Application URL

Set your application's public URL:

```bash
# Development
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Production
NEXT_PUBLIC_APP_URL=https://algapsa.yourdomain.com
```

### 7. Development: Stripe CLI (Optional but Recommended)

For local development, use the Stripe CLI to forward webhooks:

#### 7.1 Install Stripe CLI
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Windows (Scoop)
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe

# Linux
# See https://stripe.com/docs/stripe-cli#install
```

#### 7.2 Authenticate
```bash
stripe login
```

#### 7.3 Forward Webhooks
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

This will output a webhook signing secret. Copy it to `STRIPE_WEBHOOK_SECRET`.

## Testing

### Test Card Numbers

Stripe provides test cards for development:

| Card Number         | Description                          |
|---------------------|--------------------------------------|
| 4242 4242 4242 4242 | Succeeds immediately                 |
| 4000 0025 0000 3155 | Requires authentication (3D Secure)  |
| 4000 0000 0000 9995 | Declined (insufficient funds)        |

Use:
- Any future expiry date (e.g., 12/34)
- Any 3-digit CVC (e.g., 123)
- Any billing ZIP code (e.g., 12345)

### Test Purchase Flow

1. Log in to AlgaPSA as an admin user
2. Navigate to **Settings → General → User Management**
3. Click **Add License** button
4. Select quantity and click **Purchase**
5. Complete checkout with test card
6. Verify:
   - License count updated in User Management
   - Subscription appears in Stripe Dashboard
   - Webhook events logged in database

### Verify Webhook

Check webhook delivery:
1. Go to **Stripe Dashboard → Developers → Webhooks**
2. Click on your webhook endpoint
3. View recent deliveries and their status

Check database:
```sql
SELECT * FROM stripe_webhook_events
ORDER BY created_at DESC
LIMIT 10;
```

## Production Deployment

### Before Going Live

1. **Switch to Live Mode:**
   - In Stripe Dashboard, toggle to "Live mode"
   - Get new API keys (live keys start with `pk_live_` and `sk_live_`)
   - Update environment variables

2. **Create Production Webhook:**
   - Configure webhook with production URL
   - Get new webhook secret
   - Update `STRIPE_WEBHOOK_SECRET`

3. **Security Checklist:**
   - [ ] Use HTTPS for all endpoints
   - [ ] Verify webhook signatures
   - [ ] Never log full API keys
   - [ ] Use environment variables (never hardcode)
   - [ ] Rotate keys periodically
   - [ ] Monitor webhook failures

4. **Testing in Production:**
   - Create a test subscription with a real card
   - Use Stripe's test mode customer to avoid charges
   - Cancel immediately after testing

### Monitoring

Monitor these in production:
- Webhook delivery failures (Stripe Dashboard)
- Database `stripe_webhook_events` for processing errors
- Application logs for Stripe API errors
- Subscription status changes

### Support

For Stripe-related questions:
- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Support](https://support.stripe.com)
- [API Reference](https://stripe.com/docs/api)

For AlgaPSA integration issues, check:
- `server/logs/` for application errors
- Database `stripe_webhook_events` table for webhook processing
- StripeService logs in CloudWatch/your logging system

## Troubleshooting

### Webhook Not Receiving Events

1. Check webhook URL is correct and accessible
2. Verify `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
3. Check webhook is in "Live mode" for production keys
4. Test with Stripe CLI: `stripe trigger checkout.session.completed`

### Signature Verification Failed

1. Ensure you're using raw request body (not parsed JSON)
2. Verify `STRIPE_WEBHOOK_SECRET` is correct
3. Check webhook secret matches the endpoint's secret in Stripe
4. For development, use Stripe CLI to get local secret

### Customer Import Failing

1. Verify tenant exists in database
2. Check Stripe customer has email matching tenant email
3. Ensure `MASTER_BILLING_TENANT_ID` is set correctly
4. Check logs for specific error messages

### License Count Not Updating

1. Verify webhook was received and processed
2. Check `stripe_webhook_events` table for errors
3. Verify subscription metadata includes `tenant_id`
4. Check `stripe_subscriptions` table for subscription record

## Next Steps

After setup:
1. Import existing Stripe customers (if any)
2. Configure email notifications for purchases
3. Set up monitoring and alerting
4. Plan for Phase 2 (multi-tenant billing)

## NM-Store Integration (Initial Customer Subscription)

### Overview

New AlgaPSA customers purchase their initial subscription through **nm-store** (the Nine Minds website), which creates both:
1. The Stripe subscription with initial license quantity
2. The tenant record in AlgaPSA database via Temporal workflow

The AlgaPSA Stripe integration then manages license changes after the initial purchase.

### Integration Requirements

#### 1. Temporal Workflow Updates

The tenant creation workflow (`createTenantWorkflow`) needs to be updated to accept and store Stripe subscription data:

**Input Parameters Required:**
```typescript
interface CreateTenantInput {
  // Existing fields...
  email: string;
  client_name: string;

  // NEW: Stripe subscription info from nm-store checkout
  stripe_customer_id?: string;        // Stripe customer ID (cus_...)
  stripe_subscription_id?: string;    // Stripe subscription ID (sub_...)
  initial_license_count?: number;     // Initial quantity from purchase
}
```

#### 2. Stripe Customer Record Creation

During tenant creation, if Stripe data is provided, the workflow should:

```typescript
// In createTenantWorkflow or a new activity
if (input.stripe_customer_id) {
  await knex('stripe_customers').insert({
    tenant: newTenant.tenant,
    stripe_customer_external_id: input.stripe_customer_id,
    billing_tenant: process.env.MASTER_BILLING_TENANT_ID,
    email: input.email,
    name: input.client_name,
    metadata: {
      source: 'nm_store_checkout',
      created_at: new Date().toISOString()
    }
  });
}
```

#### 3. Initial License Count

Set the `licensed_user_count` on the tenant record during creation:

```typescript
await knex('tenants')
  .where({ tenant: newTenant.tenant })
  .update({
    licensed_user_count: input.initial_license_count || null
  });
```

#### 4. Subscription Import

Optionally import the full subscription details:

```typescript
if (input.stripe_subscription_id) {
  // Call StripeService to import subscription details
  const stripeService = getStripeService();
  await stripeService.importSubscriptionById(
    newTenant.tenant,
    input.stripe_subscription_id
  );
}
```

### NM-Store Checkout Flow

The nm-store checkout should:

1. **Create Stripe Customer & Subscription**
   ```javascript
   const customer = await stripe.customers.create({
     email: customerEmail,
     name: clientName,
     metadata: {
       source: 'nm_store',
       pending_tenant: true
     }
   });

   const subscription = await stripe.subscriptions.create({
     customer: customer.id,
     items: [{ price: LICENSE_PRICE_ID, quantity: licenseCount }],
     metadata: {
       source: 'nm_store_checkout',
       client_name: clientName
     }
   });
   ```

2. **Trigger Temporal Workflow**
   ```javascript
   await temporalClient.workflow.start(createTenantWorkflow, {
     args: [{
       email: customerEmail,
       client_name: clientName,
       stripe_customer_id: customer.id,
       stripe_subscription_id: subscription.id,
       initial_license_count: licenseCount,
       // ... other tenant creation params
     }],
     taskQueue: 'alga-psa-workflows',
     workflowId: `create-tenant-${customer.id}`
   });
   ```

3. **Update Customer Metadata After Tenant Creation**
   ```javascript
   // After workflow completes successfully
   await stripe.customers.update(customer.id, {
     metadata: {
       tenant_id: newTenant.tenant,  // Link customer to tenant
       algapsa_url: `https://app.algapsa.com`,
       onboarded: true
     }
   });

   await stripe.subscriptions.update(subscription.id, {
     metadata: {
       tenant_id: newTenant.tenant  // Critical for webhook event routing
     }
   });
   ```

### Migration Script for Existing Customers

For customers who already have Stripe subscriptions but no database records:

```typescript
// scripts/sync-stripe-customers.ts
async function syncExistingStripeCustomers() {
  const tenants = await knex('tenants').select('*');

  for (const tenant of tenants) {
    // Search Stripe for customer by email
    const customers = await stripe.customers.list({
      email: tenant.email,
      limit: 1
    });

    if (customers.data.length > 0) {
      const customer = customers.data[0];

      // Import customer
      await knex('stripe_customers').insert({
        tenant: tenant.tenant,
        stripe_customer_external_id: customer.id,
        billing_tenant: MASTER_BILLING_TENANT_ID,
        email: customer.email,
        name: customer.name,
        metadata: { source: 'migration_import' }
      }).onConflict(['tenant', 'stripe_customer_external_id']).ignore();

      // Import active subscriptions
      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
        status: 'active'
      });

      for (const sub of subscriptions.data) {
        // Use StripeService.importSubscription()
        await stripeService.importSubscription(
          tenant.tenant,
          customer.id,
          sub
        );

        // Update tenant license count
        const quantity = sub.items.data[0]?.quantity || 0;
        await knex('tenants')
          .where({ tenant: tenant.tenant })
          .update({ licensed_user_count: quantity });
      }
    }
  }
}
```

### Testing the Integration

1. **Test Tenant Creation with Stripe Data:**
   ```bash
   # Create test customer in Stripe
   stripe customers create \
     --email test@example.com \
     --name "Test Company" \
     --metadata[source]=nm_store_test

   # Create test subscription
   stripe subscriptions create \
     --customer cus_xxx \
     --items[0][price]=price_xxx \
     --items[0][quantity]=10

   # Trigger workflow with test data
   # Verify tenant created with correct licensed_user_count
   ```

2. **Verify Data Flow:**
   - Customer record in `stripe_customers` table
   - Subscription record in `stripe_subscriptions` table
   - Correct `licensed_user_count` on tenant
   - Metadata linking customer to tenant

### Important Notes

- **Always set `metadata.tenant_id`** on subscriptions - this is critical for webhook event routing
- The initial subscription is created by nm-store, subsequent changes via AlgaPSA UI
- License count in AlgaPSA = Stripe subscription quantity (not additive)
- Subscription updates in AlgaPSA update the same Stripe subscription

## Phase 2: Multi-Tenant Billing (Future)

Phase 2 will enable your customers to use their own Stripe accounts to charge their clients. This requires:
- Stripe Connect integration
- Vault for storing tenant Stripe keys
- UI for tenant Stripe account connection
- Platform fee configuration

This will be documented separately when Phase 2 is implemented.
