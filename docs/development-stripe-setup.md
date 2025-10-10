# Stripe Test Mode Setup for Development

This guide shows you how to set up Stripe in test mode for local development of the license purchasing feature.

## Prerequisites

- Stripe account (free to create at https://stripe.com)
- AlgaPSA running locally
- nm-store running locally (optional for now)

## Step 1: Get Your Stripe Test Keys

1. **Sign up for Stripe** (if you haven't already):
   - Go to https://stripe.com
   - Click "Sign up"
   - Complete the registration

2. **Access the Dashboard**:
   - Go to https://dashboard.stripe.com
   - Make sure you're in **Test mode** (toggle in the top right should say "Test mode")

3. **Get Your Publishable Key**:
   - Go to https://dashboard.stripe.com/test/apikeys
   - Copy the **Publishable key** (starts with `pk_test_...`)
   - This is safe to expose in your frontend code

4. **Get Your Secret Key** (for nm-store):
   - On the same page, reveal and copy the **Secret key** (starts with `sk_test_...`)
   - ⚠️ **Never commit this to git** - it should only be in nm-store's environment

## Step 2: Configure AlgaPSA

1. **Update `.env.development`**:
   ```bash
   # Stripe Configuration (TEST MODE)
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51abc...xyz

   # nm-store Integration
   NM_STORE_URL=http://localhost:3001
   NEXT_PUBLIC_NM_STORE_URL=http://localhost:3001
   ALGA_AUTH_KEY=dev-alga-auth-key
   ```

2. **Restart your dev server**:
   ```bash
   npm run dev
   ```

## Step 3: Test the Flow (Without nm-store)

For now, you can test the UI without nm-store by creating a mock endpoint:

**Create:** `server/src/app/api/internal/create-license-checkout/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

/**
 * TEMPORARY MOCK for testing UI without nm-store
 * This returns a mock client secret for Stripe embedded checkout
 * Replace this with actual nm-store integration later
 */
export async function POST(req: NextRequest) {
  try {
    // In a real scenario, this would call Stripe to create a session
    // For now, we'll return a mock response to test the UI

    const body = await req.json();
    console.log('Mock checkout request:', body);

    // Mock response - this won't actually work with Stripe
    // You'd need to create a real session via Stripe SDK
    return NextResponse.json({
      success: false,
      error: 'nm-store integration not yet configured. See docs/development-stripe-setup.md'
    });

  } catch (error) {
    console.error('Error in mock checkout:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## Step 4: Full Integration with nm-store (When Ready)

When you're ready to test the full flow with nm-store:

### nm-store Configuration

1. **Create a product in Stripe** (Test mode):
   - Go to https://dashboard.stripe.com/test/products
   - Click "Add product"
   - Name: "AlgaPSA User License"
   - Pricing: Recurring, $50/month
   - Copy the **Price ID** (starts with `price_...`)

2. **Configure nm-store**:
   ```bash
   # .env in nm-store
   STRIPE_SECRET_KEY=sk_test_51abc...xyz
   ALGA_AUTH_KEY=dev-alga-auth-key  # Must match AlgaPSA's
   ALGAPSA_URL=http://localhost:3000
   ```

3. **Implement the endpoint** in nm-store (see `docs/nm-store-integration.md`)

4. **Start nm-store**:
   ```bash
   npm run dev  # or whatever command starts nm-store
   ```

## Step 5: Test the Complete Flow

1. **Login to AlgaPSA** as a user

2. **Navigate to User Management**:
   - Go to Settings → Users

3. **Simulate license limit**:
   - Temporarily set your tenant's `licensed_user_count` to match current users:
   ```sql
   UPDATE tenants SET licensed_user_count = (
     SELECT COUNT(*) FROM users
     WHERE tenant = '<your-tenant-id>'
     AND user_type = 'internal'
     AND is_inactive = false
   );
   ```

4. **Click "Add License"** button

5. **Select license quantity**:
   - Choose how many licenses to add (e.g., 2)

6. **Proceed to checkout**:
   - Embedded Stripe checkout should appear

7. **Use test card**:
   - Card number: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., `12/34`)
   - CVC: Any 3 digits (e.g., `123`)
   - ZIP: Any 5 digits (e.g., `12345`)

8. **Complete payment**:
   - Click "Subscribe"
   - You should be redirected to success page

9. **Verify license count updated**:
   ```sql
   SELECT licensed_user_count, last_license_update
   FROM tenants
   WHERE tenant = '<your-tenant-id>';
   ```

## Test Cards

Stripe provides many test cards for different scenarios:

### Success
- **4242 4242 4242 4242** - Succeeds immediately
- **4000 0025 0000 3155** - Requires 3D Secure authentication

### Failures
- **4000 0000 0000 9995** - Declined (insufficient funds)
- **4000 0000 0000 0002** - Declined (generic)
- **4000 0000 0000 0341** - Declined (lost card)

Full list: https://stripe.com/docs/testing#cards

## Webhook Testing

If you want to test webhooks locally:

1. **Install Stripe CLI**:
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe

   # Or download from: https://stripe.com/docs/stripe-cli
   ```

2. **Login to Stripe**:
   ```bash
   stripe login
   ```

3. **Forward webhooks to local server**:
   ```bash
   stripe listen --forward-to localhost:3001/api/webhooks/stripe
   ```

4. **Use the webhook signing secret**:
   - The CLI will display a webhook signing secret (starts with `whsec_...`)
   - Add it to nm-store's `.env`:
     ```bash
     STRIPE_WEBHOOK_SECRET=whsec_abc...xyz
     ```

## Troubleshooting

### "Stripe publishable key not configured"
- Check that `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set in `.env.development`
- Make sure it starts with `pk_test_`
- Restart your dev server after changing .env files

### "Failed to create checkout session"
- Check that nm-store is running on the correct port
- Verify `NM_STORE_URL` matches nm-store's address
- Check `ALGA_AUTH_KEY` matches in both AlgaPSA and nm-store

### Checkout doesn't load
- Open browser console (F12) and check for errors
- Verify the `clientSecret` is being returned from the API
- Make sure Stripe.js is loading (check Network tab)

### Webhook not received
- Make sure Stripe CLI is running with `stripe listen`
- Check webhook endpoint is accessible
- Verify webhook secret matches in nm-store config

## Next Steps

Once everything works in test mode:

1. **Production Setup** (when ready):
   - Switch to live mode in Stripe dashboard
   - Get live API keys (`pk_live_...` and `sk_live_...`)
   - Update environment variables in production
   - Configure production webhook endpoints

2. **nm-store Integration**:
   - Implement full endpoints per `docs/nm-store-integration.md`
   - Set up webhook handlers
   - Add email validation on order form

## Resources

- [Stripe Test Mode](https://stripe.com/docs/testing)
- [Stripe Embedded Checkout](https://stripe.com/docs/payments/checkout/how-checkout-works)
- [Stripe Test Cards](https://stripe.com/docs/testing#cards)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [AlgaPSA Integration Docs](./nm-store-integration.md)
