# nm-store Integration Requirements

This document outlines the API requirements for nm-store to support license purchasing from within AlgaPSA.

## Overview

The license purchasing flow allows logged-in AlgaPSA users to purchase additional licenses directly from the AlgaPSA interface. The flow works as follows:

1. User clicks "Add License" button in AlgaPSA
2. AlgaPSA calls nm-store API to create a Stripe checkout session
3. nm-store returns the client secret
4. AlgaPSA embeds the Stripe checkout
5. User completes payment
6. nm-store webhook calls AlgaPSA to update license count

## Required nm-store API Endpoints

### 1. Create License Checkout Session

**Endpoint:** `POST /api/internal/create-license-checkout`

**Purpose:** Create a Stripe checkout session for an existing AlgaPSA tenant to add licenses

**Authentication:**
- Header: `X-Internal-Secret: <ALGA_AUTH_KEY>`
- This is a shared secret between AlgaPSA and nm-store

**Request Body:**
```json
{
  "tenantId": "uuid",           // AlgaPSA tenant ID
  "email": "user@example.com",  // User's email (for customer lookup)
  "licenseCount": 5,            // Number of licenses to add
  "type": "add_licenses",       // Type of purchase
  "firstName": "John",          // User's first name
  "lastName": "Doe"             // User's last name
}
```

**Response:**
```json
{
  "success": true,
  "clientSecret": "cs_test_...",  // Stripe checkout session client secret
  "sessionId": "cs_test_...",     // Stripe checkout session ID
  "customerId": "cus_..."         // Stripe customer ID (optional)
}
```

**Implementation Requirements:**
1. Look up existing Stripe customer by email or create new one
2. Create Stripe checkout session with:
   - Mode: 'subscription'
   - Line items: License product × quantity
   - Customer email pre-filled
   - Success URL: `${ALGAPSA_URL}/msp/licenses/success?session_id={CHECKOUT_SESSION_ID}`
   - Cancel URL: `${ALGAPSA_URL}/msp/licenses/purchase`
3. Store `tenantId` in checkout session metadata for webhook processing
4. Return client secret for embedded checkout

**Example Implementation:**
```typescript
// nm-store: app/api/internal/create-license-checkout/route.ts
export async function POST(req: NextRequest) {
  // 1. Verify X-Internal-Secret header
  const secret = req.headers.get('x-internal-secret');
  if (secret !== process.env.ALGA_AUTH_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tenantId, email, licenseCount, firstName, lastName } = await req.json();

  // 2. Look up or create Stripe customer
  const customers = await stripe.customers.list({ email, limit: 1 });
  let customer;
  if (customers.data.length > 0) {
    customer = customers.data[0];
  } else {
    customer = await stripe.customers.create({
      email,
      name: `${firstName} ${lastName}`,
      metadata: { algaTenantId: tenantId }
    });
  }

  // 3. Create checkout session
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customer.id,
    ui_mode: 'embedded',
    line_items: [{
      price: 'price_...', // Your license price ID
      quantity: licenseCount
    }],
    return_url: `${process.env.ALGAPSA_URL}/msp/licenses/success?session_id={CHECKOUT_SESSION_ID}`,
    metadata: {
      tenantId,
      type: 'add_licenses'
    }
  });

  return NextResponse.json({
    success: true,
    clientSecret: session.client_secret,
    sessionId: session.id,
    customerId: customer.id
  });
}
```

### 2. Existing Endpoint Updates

The existing nm-store webhooks need to be updated to handle the new `add_licenses` type:

**Stripe Webhook Handler:**
```typescript
// When checkout.session.completed event is received
if (session.metadata?.type === 'add_licenses') {
  const tenantId = session.metadata.tenantId;
  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  const licenseCount = subscription.items.data[0].quantity;

  // Call AlgaPSA webhook to update license count
  await callAlgaPSAWebhook(tenantId, licenseCount, event.id);
}
```

## Website Order Form Validation

When users try to order from the nm-store website (not logged into AlgaPSA):

### Email Validation Check

**Endpoint to Call:** `POST https://algapsa.com/api/internal/check-tenant-email`

**Authentication:**
- Header: `X-Internal-Secret: <ALGA_AUTH_KEY>`

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "exists": true,
  "tenantId": "uuid",
  "email": "user@example.com"
}
```

**Implementation in nm-store OrderForm:**

1. When user enters email and blurs the field, validate it
2. If `exists: true`, show warning message:
   ```
   Account already exists. If you'd like to add more licenses,
   please make sure you are signed into AlgaPSA and click here
   ```
3. The "click here" link should go to: `https://algapsa.com/auth/msp/signin?callbackUrl=/msp/licenses/purchase`
4. Prevent form submission if account exists

**Example Implementation:**
```typescript
// nm-store: components/OrderForm.tsx
const validateEmailAgainstAlgaPSA = async (email: string) => {
  try {
    const response = await fetch('https://algapsa.com/api/internal/check-tenant-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': process.env.NEXT_PUBLIC_ALGA_AUTH_KEY // Client-safe key
      },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (data.exists) {
      setEmailError(
        <>
          Account already exists. If you'd like to add more licenses,
          please make sure you are signed into AlgaPSA and{' '}
          <a
            href="https://algapsa.com/auth/msp/signin?callbackUrl=/msp/licenses/purchase"
            className="underline hover:text-blue-700"
            target="_blank"
            rel="noopener noreferrer"
          >
            click here
          </a>
        </>
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error validating email:', error);
    // Fail open - don't block user
    return true;
  }
};
```

## Environment Variables

### AlgaPSA
```bash
NM_STORE_URL=https://store.nineminds.com
NEXT_PUBLIC_NM_STORE_URL=https://store.nineminds.com
ALGA_AUTH_KEY=<shared-secret>
ALGA_WEBHOOK_SECRET=<webhook-secret>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### nm-store
```bash
ALGAPSA_URL=https://algapsa.com
ALGA_AUTH_KEY=<shared-secret>  # Same as AlgaPSA's
ALGA_WEBHOOK_SECRET=<webhook-secret>  # For calling AlgaPSA webhooks
STRIPE_SECRET_KEY=sk_live_...
```

## Security Considerations

1. **API Authentication:**
   - All inter-service API calls use `X-Internal-Secret` header
   - Shared secret should be strong and rotated regularly
   - Only HTTPS connections in production

2. **Webhook Security:**
   - Existing HMAC signature verification for webhooks
   - Idempotency using Stripe event IDs

3. **Customer Data:**
   - Store minimal customer data in both systems
   - AlgaPSA tenantId stored in Stripe customer metadata
   - Email is the primary identifier for customer lookup

## Testing

### Test Mode
1. Use Stripe test keys (`pk_test_...` and `sk_test_...`)
2. Test cards: `4242 4242 4242 4242`
3. Verify webhooks in Stripe dashboard

### Integration Testing
1. Create test tenant in AlgaPSA
2. Add licenses via AlgaPSA UI
3. Verify checkout session created
4. Complete payment with test card
5. Verify license count updated in AlgaPSA
6. Test website form validation with existing email

## Deployment Checklist

### nm-store
- [ ] Implement `/api/internal/create-license-checkout` endpoint
- [ ] Update Stripe webhook handler for `add_licenses` type
- [ ] Add email validation in website order form
- [ ] Set `ALGAPSA_URL` and `ALGA_AUTH_KEY` environment variables
- [ ] Test end-to-end flow in staging

### AlgaPSA
- [ ] Set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] Set `NM_STORE_URL` and `ALGA_AUTH_KEY`
- [ ] Create success/cancel pages for checkout
- [ ] Test embedded checkout flow
- [ ] Monitor webhook logs

## Success/Cancel Pages

AlgaPSA needs these pages:

### Success Page
**URL:** `/msp/licenses/success?session_id={CHECKOUT_SESSION_ID}`

Displays:
- Success message
- License count updated
- Link back to user management

### Cancel Page
**URL:** `/msp/licenses/purchase` (existing page with back button)

No special handling needed - user returns to license selection form.

## Support

For integration issues:
- AlgaPSA: Check logs at `/var/log/alga-psa/`
- nm-store: Check Stripe dashboard for webhook events
- Both: Verify `ALGA_AUTH_KEY` matches on both systems
